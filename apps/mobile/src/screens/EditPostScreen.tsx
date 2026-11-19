import React, { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import MapView, { Marker } from 'react-native-maps';
import { api, Post } from '../lib/api';
import { Btn, ErrorText, Field, Layout, Loading, Muted, Select, Title } from '../components/ui';
import { LocationSearch } from '../components/LocationSearch';
import { Center, getDeviceCenter } from './LocationScreen';
import { C } from '../theme/theme';

const categories = ['Food', 'Sports', 'Music', 'Outdoors', 'Social', 'Other'].map(value => ({ value, label: value }));

// Edits existing activity details while keeping its photo and social interactions.
export function EditPostScreen({ id, onBack, onSaved }: { id: string; onBack: () => void; onSaved: (id: string) => void }) {
  const [post, setPost] = useState<Post | null>(null);
  const [form, setForm] = useState({ title: '', description: '', category: '', placeName: '' });
  const [location, setLocation] = useState<Center | null>(null);
  const [activityAt, setActivityAt] = useState<Date | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'save' | 'gps' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const map = useRef<MapView>(null);
  const busy = action !== null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    // Loads the saved values and refuses to show an editor for someone else's activity.
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const saved = await api<Post>(`/posts/${id}`);
        if (!current) return;
        if (!saved.isOwn) throw new Error('Only the creator can edit this activity.');
        if (saved.status === 'ANALYZING') throw new Error('Wait for photo analysis before editing this activity.');
        setPost(saved);
        setForm({ title: saved.title || '', description: saved.description || '', category: saved.category || '', placeName: saved.place_name });
        setLocation({ latitude: saved.latitude, longitude: saved.longitude, name: saved.place_name });
        setActivityAt(new Date(saved.activity_at || saved.published_at || saved.created_at));
      } catch (error: any) {
        if (current) setError(error.message);
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [id, attempt]);
  useEffect(() => {
    if (location) map.current?.animateToRegion({ ...location, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 300);
  }, [location?.latitude, location?.longitude]);

  // Keeps the activity pin approximate without moving the Nearby discovery center.
  function selectLocation(next: Center) {
    if (pending.current) return;
    setLocation({ ...next, latitude: Number(next.latitude.toFixed(3)), longitude: Number(next.longitude.toFixed(3)) });
    setForm(current => ({ ...current, placeName: next.name }));
  }

  // Uses GPS only when requested and keeps the previous pin on failure.
  async function useLocation() {
    if (pending.current) return;
    pending.current = true;
    setAction('gps');
    setError(null);
    try {
      const next = await getDeviceCenter();
      if (mounted.current) {
        setLocation({ ...next, latitude: Number(next.latitude.toFixed(3)), longitude: Number(next.longitude.toFixed(3)) });
        setForm(current => ({ ...current, placeName: next.name }));
      }
    } catch (error: any) {
      if (mounted.current) setError(error.message);
    } finally {
      pending.current = false;
      if (mounted.current) setAction(null);
    }
  }

  // Sends only editable fields; the backend checks ownership and expiration rules.
  async function save() {
    if (pending.current || !post || !location || !activityAt) return;
    if (!form.title.trim() || !form.description.trim() || !form.category || !form.placeName.trim()) {
      setError('Add a title, description, category, and location.');
      return;
    }
    pending.current = true;
    setAction('save');
    setError(null);
    try {
      await api<Post>(`/posts/${id}`, { method: 'PATCH', body: {
        title: form.title.trim(), description: form.description.trim(), category: form.category,
        placeName: form.placeName.trim(), latitude: location.latitude, longitude: location.longitude,
        activityAt: activityAt.toISOString(),
      } });
      if (mounted.current) onSaved(id);
    } catch (error: any) {
      if (mounted.current) setError(error.message);
    } finally {
      pending.current = false;
      if (mounted.current) setAction(null);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Layout>
        <Btn label="‹ Back" secondary disabled={action === 'save'} onPress={onBack} />
        <Title>Edit activity.</Title>
        {loading ? <Loading /> : post ? <>
          {post.imageUrl ? <Image source={{ uri: post.imageUrl }} style={{ height: 160, width: '100%', borderRadius: 20, marginBottom: 18 }} /> : null}
          <Field label="Activity title" value={form.title} maxLength={100} editable={!busy} onChangeText={title => setForm(current => ({ ...current, title }))} />
          <Field label="Description" value={form.description} multiline maxLength={1000} editable={!busy} onChangeText={description => setForm(current => ({ ...current, description }))} />
          <Select label="Category" value={form.category} options={categories} disabled={busy} onSelect={category => setForm(current => ({ ...current, category }))} />
          <Text style={{ color: C.ink, fontWeight: '700', marginTop: 18 }}>Activity location</Text>
          <LocationSearch selected={location} disabled={busy} onSelect={selectLocation} />
          <Btn label={action === 'gps' ? 'Finding location…' : 'My location'} secondary disabled={busy} onPress={useLocation} />
          {location ? <View style={{ height: 220, borderRadius: 20, overflow: 'hidden', marginVertical: 12 }}>
            <MapView ref={map} style={{ flex: 1 }} initialRegion={{ ...location, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
              onPress={event => { if (!busy) selectLocation({ ...event.nativeEvent.coordinate, name: 'Selected map pin' }); }}>
              <Marker coordinate={location} title={form.placeName} pinColor={C.green} />
            </MapView>
          </View> : null}
          <Field label="Location name" value={form.placeName} maxLength={150} editable={!busy} onChangeText={placeName => setForm(current => ({ ...current, placeName }))} />
          <Muted>Public activity coordinates stay approximate. Your Nearby area is unchanged.</Muted>
          <Text style={{ color: C.ink, fontWeight: '700', marginTop: 18 }}>Activity date and time</Text>
          <Muted>{activityAt?.toLocaleString()}</Muted>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><Btn label="Change date" secondary disabled={busy} onPress={() => setPicker('date')} /></View>
            <View style={{ flex: 1 }}><Btn label="Change time" secondary disabled={busy} onPress={() => setPicker('time')} /></View>
          </View>
          {picker && activityAt ? <DateTimePicker value={activityAt} mode={picker} display={Platform.OS === 'ios' ? 'spinner' : 'default'} disabled={busy}
            onChange={(_event, value) => {
              if (Platform.OS === 'android') setPicker(null);
              if (value) setActivityAt(value);
            }} /> : null}
          {picker && Platform.OS === 'ios' ? <Btn label="Done" secondary disabled={busy} onPress={() => setPicker(null)} /> : null}
          <Muted>Changing the start time recalculates expiration. Other edits keep the existing deadline.</Muted>
          <Btn label={action === 'save' ? 'Saving…' : 'Save changes'} disabled={busy} onPress={save} />
        </> : null}
        <ErrorText message={error} />
        {!loading && !post ? <Btn label="Retry loading" secondary onPress={() => setAttempt(value => value + 1)} /> : null}
      </Layout>
    </KeyboardAvoidingView>
  );
}
