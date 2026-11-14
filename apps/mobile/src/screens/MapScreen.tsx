import React, { useEffect, useRef, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import MapView, { Circle, Marker, Region } from 'react-native-maps';
import { Center } from './LocationScreen';
import { activityFilters, ActivityFilter, api, nearbyUrl, Post } from '../lib/api';
import { Btn, ErrorText, Layout, Loading, Muted, Select, Title } from '../components/ui';
import { LocationSearch } from '../components/LocationSearch';
import { C } from '../theme/theme';

const radiusOptions = [0.5, 1, 2, 5, 10, 25, 50].map(value => ({ value: String(value), label: `${value} ${value === 1 ? 'mile' : 'miles'}` }));

// Shows a bounded map with place search and a shared feed radius.
export function MapScreen({ center, radius, onRadiusChange, onSelect, onPost, onBack }: {
  center: Center;
  radius: number;
  onRadiusChange: (radius: number) => void;
  onSelect: (center: Center, radius: number) => void;
  onPost: (id: string) => void;
  onBack: () => void;
}) {
  const [mapCenter, setMapCenter] = useState(center);
  const [posts, setPosts] = useState<Post[]>([]);
  const [time, setTime] = useState<ActivityFilter>('now');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const map = useRef<MapView>(null);
  const { height, width } = useWindowDimensions();
  const mapHeight = Math.max(220, Math.min(360, height * 0.43));
  const region: Region = {
    latitude: mapCenter.latitude,
    longitude: mapCenter.longitude,
    latitudeDelta: radius * 2.5 / 69,
    longitudeDelta: Math.min(180, radius * 2.5 / (69 * Math.max(0.1, Math.cos(mapCenter.latitude * Math.PI / 180))) * Math.max(1, (width - 40) / mapHeight)),
  };

  useEffect(() => {
    let current = true;
    // Loads activities for this selection and ignores responses from older selections.
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextPosts = await api<Post[]>(nearbyUrl(mapCenter.latitude, mapCenter.longitude, radius, 'All', '', time));
        if (current) setPosts(nextPosts);
      } catch (error: any) {
        if (current) { setPosts([]); setError(error.message); }
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [mapCenter.latitude, mapCenter.longitude, radius, time]);
  useEffect(() => {
    map.current?.animateToRegion(region, 300);
  }, [mapCenter.latitude, mapCenter.longitude, radius]);
  return (
    <Layout>
      <Text accessibilityRole="button" style={{ color: C.green }} onPress={onBack}>‹ Back</Text>
      <Title>Explore an area.</Title>
      <LocationSearch onSelect={setMapCenter} />
      <Select
        label="Search radius"
        value={String(radius)}
        options={radiusOptions}
        onSelect={value => onRadiusChange(Number(value))}
      />
      <View style={{ flexDirection: 'row', gap: 18, marginVertical: 12 }}>
        {activityFilters.map(({ value, label }) => (
          <Text
            key={value}
            accessibilityRole="button"
            style={{ color: time === value ? C.green : C.muted, fontWeight: time === value ? '700' : '400' }}
            onPress={() => setTime(value)}
          >
            {label}
          </Text>
        ))}
      </View>
      <Muted>📍 {mapCenter.name}</Muted>
      <View
        style={{
          height: mapHeight,
          width: '100%',
          borderRadius: 23,
          overflow: 'hidden',
          marginVertical: 14,
          borderWidth: 1,
          borderColor: C.border
        }}
      >
        <MapView
          ref={map}
          style={{ flex: 1 }}
          initialRegion={region}
          zoomEnabled
          zoomControlEnabled
          onPress={event => {
            if (event.nativeEvent.action === 'marker-press') return;
            const { latitude, longitude } = event.nativeEvent.coordinate;
            setMapCenter({ latitude, longitude, name: 'Selected map pin', isManual: true });
          }}
        >
          <Marker coordinate={mapCenter} title={mapCenter.name} pinColor={C.green} />
          <Circle
            center={mapCenter}
            radius={radius * 1609.344}
            strokeColor={C.green}
            fillColor="rgba(23,107,85,0.08)"
          />
          {posts.map(post => (
            <Marker
              key={post.id}
              coordinate={{ latitude: post.latitude, longitude: post.longitude }}
              title={post.title || 'Activity'}
              description={post.place_name}
              onPress={event => event.stopPropagation()}
              onCalloutPress={() => onPost(post.id)}
            />
          ))}
        </MapView>
      </View>
      <Muted>Tap the map to adjust your search location.</Muted>
      {loading ? <Loading label="Finding activities…" /> : <Muted style={{ marginTop: 10 }}>{posts.length} activities within {radius} mi</Muted>}
      <ErrorText message={error} />
      <Btn label="Explore this area →" onPress={() => onSelect(mapCenter, radius)} />
    </Layout>
  );
}
