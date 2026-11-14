import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import MapView, { Circle, Marker, Region } from 'react-native-maps';
import { Center } from './LocationScreen';
import { api, nearbyUrl, Post } from '../lib/api';
import { Btn, ErrorText, Layout, Muted, Title } from '../components/ui';
import { C } from '../theme/theme';

export function MapScreen({ center, onSelect, onPost, onBack }: { center: Center; onSelect: (c: Center) => void; onPost: (id:string) => void; onBack: () => void }) {
  const [mapCenter, setMapCenter] = useState(center); const [posts, setPosts] = useState<Post[]>([]);
  const [radius, setRadius] = useState(10); const [error, setError] = useState<string|null>(null);
  const load = useCallback(async () => {
    try { setPosts(await api<Post[]>(nearbyUrl(mapCenter.latitude, mapCenter.longitude, radius, 'All', ''))); setError(null); }
    catch (e: any) { setError(e.message); }
  }, [mapCenter.latitude, mapCenter.longitude, radius]);
  useEffect(() => { void load(); }, [load]);
  const initialRegion: Region = { latitude: center.latitude, longitude: center.longitude, latitudeDelta: 0.15, longitudeDelta: 0.15 };
  return <Layout scroll={false}>
    <View style={{ padding: 20, paddingBottom: 8 }}><Text style={{ color: C.green }} onPress={onBack}>‹ Back</Text><Title>Explore an area.</Title><Muted>Tap the map to choose a search center. Markers show published activity locations.</Muted>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 9 }}><Text style={{ color: C.muted }} onPress={() => setRadius(2)}>2 mi</Text><Text style={{ color: C.muted }} onPress={() => setRadius(5)}> · 5 mi</Text><Text style={{ color: C.muted }} onPress={() => setRadius(10)}> · 10 mi</Text><Text style={{ color: C.muted }} onPress={() => setRadius(25)}> · 25 mi</Text></View>
      <Muted>{posts.length} activities within {radius} mi</Muted><ErrorText message={error}/></View>
    <MapView style={{ flex: 1 }} initialRegion={initialRegion} onPress={e => setMapCenter({ latitude: e.nativeEvent.coordinate.latitude, longitude: e.nativeEvent.coordinate.longitude, name: 'Custom selected map area', isManual: true })}>
      <Marker coordinate={{ latitude: mapCenter.latitude, longitude: mapCenter.longitude }} title="Search center" pinColor={C.green}/>
      <Circle center={{ latitude: mapCenter.latitude, longitude: mapCenter.longitude }} radius={radius * 1609.344} strokeColor={C.green} fillColor="rgba(23,107,85,0.08)"/>
      {posts.map(p => <Marker key={p.id} coordinate={{ latitude: p.latitude, longitude: p.longitude }} title={p.title || 'Activity'} description={p.place_name} onCalloutPress={() => onPost(p.id)} />)}
    </MapView>
    <View style={{ backgroundColor: C.canvas, paddingHorizontal: 20, paddingBottom: 12 }}><Btn label="Explore this area →" onPress={() => onSelect(mapCenter)}/></View>
  </Layout>;
}
