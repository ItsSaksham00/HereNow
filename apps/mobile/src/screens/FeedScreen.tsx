import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from '../theme/theme';
import { api, milesBetween, nearbyUrl, Post, timeAgo } from '../lib/api';
import { Center } from './LocationScreen';
import { ErrorText, IconButton, Loading, Muted, Title } from '../components/ui';

export function FeedScreen({ center, onMap, onPost, onLocation }: { center: Center; onMap: () => void; onPost: (id:string) => void; onLocation: () => void }) {
  const [posts, setPosts] = useState<Post[]>([]); const [category, setCategory] = useState('All');
  const [radius, setRadius] = useState(10); const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string|null>(null);
  const load = useCallback(async () => {
    setError(null); try { setPosts(await api<Post[]>(nearbyUrl(center.latitude, center.longitude, radius, category, search))); }
    catch (e:any) { setError(e.message); } finally { setLoading(false); }
  }, [center.latitude, center.longitude, radius, category, search]);
  useEffect(() => { setLoading(true); const handle = setTimeout(() => { void load(); }, 250); return () => clearTimeout(handle); }, [load]);
  return <ScrollView style={{ flex: 1, backgroundColor: C.canvas }} contentContainerStyle={{ padding: 20, paddingBottom: 35 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.green}/> } keyboardShouldPersistTaps="handled">
    <View style={styles.header}>
      <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontSize: 27, fontWeight: '900' }}>Here<Text style={{ color: C.green }}>Now</Text><Text style={{ color: C.coral }}>.</Text></Text>
        <Text style={styles.subtitle} onPress={onLocation}>📍 {center.name} · {radius} mi  · Change</Text></View>
      <IconButton name="map-outline" onPress={onMap}/>
    </View>
    <Title>What's happening{ '\n' }around you?</Title>
    <Muted>Start nearby. Find something worth joining.</Muted>
    <TextInput value={search} onChangeText={setSearch} placeholder="Search activities" placeholderTextColor="#7F8C82" style={styles.search}/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 14, gap: 8 }}>
      {['All','Food','Sports','Music','Outdoors','Social','Other'].map(c => <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && { backgroundColor: C.ink }]}><Text style={{ color: category === c ? 'white' : C.muted, fontSize: 12, fontWeight: '600' }}>{c}</Text></Pressable>)}
    </ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
      {[2, 5, 10, 25].map(n => <Pressable key={n} style={{ borderWidth: 1, borderColor: radius === n ? C.green : C.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 }} onPress={() => setRadius(n)}><Text style={{ color: C.muted, fontSize: 11 }}>{n} miles</Text></Pressable>)}
    </ScrollView>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}><Muted>🟢 Within your chosen area</Muted><Muted>Nearest first ↓</Muted></View>
    <ErrorText message={error}/>
    {loading && posts.length === 0 ? <Loading label="Finding nearby activities…"/> : posts.length === 0 ? <View style={{ paddingVertical: 60, alignItems: 'center' }}><Text style={{ fontSize: 42 }}>🧭</Text><Muted style={{ textAlign: 'center', marginTop: 12 }}>No activities match yet. Try another location, category, or radius.</Muted></View> : posts.map(p => <Pressable key={p.id} style={styles.card} onPress={() => onPost(p.id)}>
      <View style={{ height: 168, backgroundColor: C.pale }}>
        {p.imageUrl ? <Image source={{ uri: p.imageUrl }} style={{ height: 168, width: '100%' }} resizeMode="cover"/> : null}
        <Text style={styles.badge}>● Happening now</Text>
        <Text style={styles.distance}>{milesBetween(center.latitude, center.longitude, p.latitude, p.longitude).toFixed(1)} mi</Text>
      </View>
      <View style={{ padding: 15 }}><Text style={styles.cardTitle}>{p.title || 'Activity'}</Text><Muted>{p.place_name} · {timeAgo(p.published_at || p.created_at)}</Muted><View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}><Text style={{ color: C.ink, fontSize: 12 }}>👤 {p.creatorName}</Text><Text style={{ color: C.green, fontSize: 12 }}>View details →</Text></View></View>
    </Pressable>)}
  </ScrollView>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subtitle: { fontSize: 11, color: C.muted, marginTop: 5 },
  search: { marginTop: 20, backgroundColor: '#FFF', borderColor: C.border, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 30, backgroundColor: '#EAEDE4' },
  card: { borderRadius: 21, backgroundColor: 'white', borderWidth: 1, borderColor: C.border, marginBottom: 16, overflow: 'hidden' },
  badge: { position: 'absolute', left: 12, top: 12, backgroundColor: C.canvas, color: C.green, borderRadius: 15, paddingHorizontal: 10, paddingVertical: 7, fontSize: 11, fontWeight: '700' },
  distance: { position: 'absolute', right: 12, bottom: 12, backgroundColor: C.ink, color: 'white', borderRadius: 15, paddingHorizontal: 10, paddingVertical: 6, fontSize: 11 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: C.ink, marginBottom: 5 },
});
