import React, { useEffect, useRef, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import MapView, { Circle, Marker, Region } from 'react-native-maps';
import { Center, getDeviceCenter } from './LocationScreen';
import { activityFilters, ActivityFilter, api, nearbyUrl, Post } from '../lib/api';
import { Btn, ErrorText, Layout, Loading, Muted, Select, Title } from '../components/ui';
import { LocationSearch } from '../components/LocationSearch';
import { C } from '../theme/theme';

const radiusOptions = [0.5, 1, 2, 5, 10, 25, 50].map(value => ({ value: String(value), label: `${value} ${value === 1 ? 'mile' : 'miles'}` }));

// Shows a bounded map with place search and a shared feed radius.
export function MapScreen({ center, onCenterChange, category, time, onTimeChange, search, radius, onRadiusChange, onSelect, onPost, onBack }: {
  center: Center;
  onCenterChange: (center: Center) => void;
  category: string;
  time: ActivityFilter;
  onTimeChange: (time: ActivityFilter) => void;
  search: string;
  radius: number;
  onRadiusChange: (radius: number) => void;
  onSelect: (center: Center, radius: number) => void;
  onPost: (id: string) => void;
  onBack: () => void;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [findingLocation, setFindingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const gpsPending = useRef(false);
  const gpsVersion = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const map = useRef<MapView>(null);
  const { height, width } = useWindowDimensions();
  const mapHeight = Math.max(220, Math.min(360, height * 0.43));
  const region: Region = {
    latitude: center.latitude,
    longitude: center.longitude,
    latitudeDelta: radius * 2.5 / 69,
    longitudeDelta: Math.min(180, radius * 2.5 / (69 * Math.max(0.1, Math.cos(center.latitude * Math.PI / 180))) * Math.max(1, (width - 40) / mapHeight)),
  };

  useEffect(() => {
    let current = true;
    // Loads activities for this selection and ignores responses from older selections.
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextPosts = await api<Post[]>(nearbyUrl(center.latitude, center.longitude, radius, category, search, time));
        if (current) setPosts(nextPosts);
      } catch (error: any) {
        if (current) { setPosts([]); setError(error.message); }
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [center.latitude, center.longitude, radius, category, search, time]);
  useEffect(() => {
    map.current?.animateToRegion(region, 300);
  }, [center.latitude, center.longitude, radius]);
  useEffect(() => () => { gpsVersion.current += 1; }, []);

  // Returns to GPS while preserving filters and the previous location if it fails.
  async function useCurrentLocation() {
    if (gpsPending.current) return;
    const version = ++gpsVersion.current;
    gpsPending.current = true;
    setFindingLocation(true);
    setLocationError(null);
    try {
      const location = await getDeviceCenter();
      if (version === gpsVersion.current) onCenterChange(location);
    } catch (error: any) {
      if (version === gpsVersion.current) setLocationError(error.message);
    } finally {
      if (version === gpsVersion.current) {
        gpsPending.current = false;
        setFindingLocation(false);
      }
    }
  }

  return (
    <Layout>
      <Text accessibilityRole="button" style={{ color: C.green }} onPress={onBack}>‹ Back</Text>
      <Title>Explore an area.</Title>
      <LocationSearch selected={center} disabled={findingLocation} onSelect={onCenterChange} />
      <Btn label={findingLocation ? 'Finding your location…' : 'Use My Current Location'} secondary disabled={findingLocation} onPress={useCurrentLocation} />
      <ErrorText message={locationError} />
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
            onPress={() => onTimeChange(value)}
          >
            {label}
          </Text>
        ))}
      </View>
      <Muted>📍 {center.name}</Muted>
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
          onMapReady={() => map.current?.animateToRegion(region, 300)}
          zoomEnabled
          zoomControlEnabled
          onPress={event => {
            if (findingLocation || event.nativeEvent.action === 'marker-press') return;
            const { latitude, longitude } = event.nativeEvent.coordinate;
            onCenterChange({ latitude, longitude, name: 'Selected map pin', isManual: true });
          }}
        >
          <Marker coordinate={center} title={center.name} pinColor={C.green} />
          <Circle
            center={center}
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
      <Btn label="Explore this area →" onPress={() => onSelect(center, radius)} />
    </Layout>
  );
}
