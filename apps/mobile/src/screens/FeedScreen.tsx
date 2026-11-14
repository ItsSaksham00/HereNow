import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from '../theme/theme';
import { activityFilters, ActivityFilter, api, formatActivityTime, milesBetween, nearbyUrl, Post, timeAgo } from '../lib/api';
import { Center } from './LocationScreen';
import { ErrorText, IconButton, Loading, Muted, Title } from '../components/ui';

// Shows nearby activities with search and category filters.
export function FeedScreen({ center, radius, onRadiusChange, onMap, onPost, onLocation }: { center: Center; radius: number; onRadiusChange: (radius: number) => void; onMap: () => void; onPost: (id: string) => void; onLocation: () => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [time, setTime] = useState<ActivityFilter>('now');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Loads activities using the current location and filters.
  const load = useCallback(async () => {
    setError(null);
    try {
      setPosts(await api<Post[]>(nearbyUrl(center.latitude, center.longitude, radius, category, search, time)));
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [center.latitude, center.longitude, radius, category, search, time]);
  useEffect(() => {
    setLoading(true);
    const refreshTimeout = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(refreshTimeout);
  }, [load]);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.canvas }}
      contentContainerStyle={{ padding: 20, paddingBottom: 35 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.green} />}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.ink, fontSize: 27, fontWeight: '900' }}>Here<Text style={{ color: C.green }}>Now</Text>
            <Text style={{ color: C.coral }}>.</Text>
          </Text>
          <Text style={styles.subtitle} onPress={onLocation}>📍 {center.name} · {radius} mi  · Change</Text>
        </View>
        <IconButton name="map-outline" onPress={onMap} />
      </View>
      <Title>What's happening{'\n'}around you?</Title>
      <Muted>Start nearby. Find something worth joining.</Muted>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search activities"
        placeholderTextColor="#7F8C82"
        style={styles.search}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: 14, gap: 8 }}
      >
        {['All', 'Food', 'Sports', 'Music', 'Outdoors', 'Social', 'Other'].map(filterCategory => (
          <Pressable
            key={filterCategory}
            onPress={() => setCategory(filterCategory)}
            style={[styles.chip, category === filterCategory && { backgroundColor: C.ink }]}
          >
            <Text style={{ color: category === filterCategory ? 'white' : C.muted, fontSize: 12, fontWeight: '600' }}>
              {filterCategory}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 12 }}
        contentContainerStyle={{ gap: 8 }}
      >
        {[2, 5, 10, 25].map(radiusOption => (
          <Pressable
            key={radiusOption}
            style={{
              borderWidth: 1,
              borderColor: radius === radiusOption ? C.green : C.border,
              borderRadius: 16,
              paddingHorizontal: 10,
              paddingVertical: 5
            }}
            onPress={() => onRadiusChange(radiusOption)}
          >
            <Text style={{ color: C.muted, fontSize: 11 }}>
              {radiusOption} miles</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {activityFilters.map(({ value, label }) => (
          <Pressable
            key={value}
            onPress={() => setTime(value)}
            style={[styles.chip, time === value && { backgroundColor: C.ink }]}
          >
            <Text style={{ color: time === value ? 'white' : C.muted, fontSize: 12 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
        <Muted>🟢 Within your chosen area</Muted>
        <Muted>Nearest first ↓</Muted>
      </View>
      <ErrorText message={error} />
      {loading && posts.length === 0 ? <Loading label="Finding nearby activities…" /> : posts.length === 0 ? (
        <View style={{ paddingVertical: 60, alignItems: 'center' }}>
          <Text style={{ fontSize: 42 }}>🧭</Text>
          <Muted style={{ textAlign: 'center', marginTop: 12 }}>No activities match yet. Try another location, category, or radius.</Muted>
        </View>
      ) : posts.map(post => (
        <Pressable key={post.id} style={styles.card} onPress={() => onPost(post.id)}>
          <View style={{ height: 168, backgroundColor: C.pale }}>
            {post.imageUrl
              ? <Image source={{ uri: post.imageUrl }} style={{ height: 168, width: '100%' }} resizeMode="cover" />
              : null}
            <Text style={styles.badge}>
              {post.activity_at && new Date(post.activity_at).getTime() > Date.now() ? '◷ Upcoming' : '● Happening now'}
            </Text>
            <Text style={styles.distance}>
              {milesBetween(center.latitude, center.longitude, post.latitude, post.longitude).toFixed(1)} mi</Text>
          </View>
          <View style={{ padding: 15 }}>
            <Text style={styles.cardTitle}>
              {post.title || 'Activity'}
            </Text>
            <Muted>
              {post.place_name} · {timeAgo(post.published_at || post.created_at)}
            </Muted>
            <Muted style={{ marginTop: 6 }}>🕒 {formatActivityTime(post.activity_at)}</Muted>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
              <Text style={{ color: C.ink, fontSize: 12 }}>👤 {post.creatorName}
              </Text>
              <Text style={{ color: C.green, fontSize: 12 }}>View details →</Text>
            </View>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subtitle: { fontSize: 11, color: C.muted, marginTop: 5 },
  search: {
    marginTop: 20,
    backgroundColor: '#FFF',
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 30,
    backgroundColor: '#EAEDE4'
  },
  card: {
    borderRadius: 21,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
    overflow: 'hidden'
  },
  badge: {
    position: 'absolute',
    left: 12,
    top: 12,
    backgroundColor: C.canvas,
    color: C.green,
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 11,
    fontWeight: '700'
  },
  distance: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    backgroundColor: C.ink,
    color: 'white',
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 11
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: C.ink, marginBottom: 5 },
});
