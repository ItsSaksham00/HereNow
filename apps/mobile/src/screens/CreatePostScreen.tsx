import React, { useEffect, useRef, useState } from 'react';
import { Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { uuid } from 'expo';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import MapView, { Marker } from 'react-native-maps';
import { ApiError, api, photoForm, Post, PostSuggestions } from '../lib/api';
import { Btn, ErrorText, Field, Layout, Loading, Muted, Select, Title } from '../components/ui';
import { LocationSearch } from '../components/LocationSearch';
import { Center } from './LocationScreen';
import { C } from '../theme/theme';

const categories = ['Food', 'Sports', 'Music', 'Outdoors', 'Social', 'Other'].map(value => ({ value, label: value }));

// Keeps posting short while allowing optional suggestions and confirmed locations.
export function CreatePostScreen({ center, onPosted }: { center: Center; onPosted: (id: string) => void }) {
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [form, setForm] = useState({ title: '', description: '', category: '', placeName: '', labels: '' });
  const [location, setLocation] = useState<Center | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [timing, setTiming] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 3600000));
  const [androidPicker, setAndroidPicker] = useState<'date' | 'time' | null>(null);
  const [action, setAction] = useState<'photo' | 'location' | 'ai' | 'publish' | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(false);
  const requestId = useRef<string | null>(null);
  const upload = useRef<FormData | null>(null);
  const map = useRef<MapView>(null);
  const busy = action !== null;
  const locked = busy || submitted;

  useEffect(() => {
    if (location) map.current?.animateToRegion({ ...location, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 300);
  }, [location?.latitude, location?.longitude, locationOpen]);

  // Opens the camera or library and keeps the chosen image editable before publishing.
  async function choose(camera: boolean) {
    if (pending.current || submitted) return;
    pending.current = true;
    setAction('photo');
    setError(null);
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Photo access was denied. You can enable it in Settings.');
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible
      };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]) {
        photoForm(result.assets[0]);
        setPhoto(result.assets[0]);
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  // Marks a real place or pin for confirmation before it can be published.
  function selectLocation(next: Center) {
    if (locked) return;
    const selected = { ...next, latitude: Number(next.latitude.toFixed(3)), longitude: Number(next.longitude.toFixed(3)) };
    setLocation(selected);
    setForm(current => ({ ...current, placeName: selected.name }));
    setConfirmed(false);
  }

  // Uses approximate device coordinates only after an explicit request.
  async function useDeviceLocation() {
    if (pending.current || submitted) return;
    pending.current = true;
    setAction('location');
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Location access was denied. Search for a place or tap the map instead.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const latitude = Number(position.coords.latitude.toFixed(3));
      const longitude = Number(position.coords.longitude.toFixed(3));
      const addresses = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
      const address = addresses[0];
      const name = address?.formattedAddress || [address?.name, address?.city || address?.district].filter(Boolean).join(', ') || 'Near my location';
      setLocation({ latitude, longitude, name });
      setForm(current => ({ ...current, placeName: name }));
      setConfirmed(false);
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  // Fills only fields that are still empty when suggestions arrive.
  async function fillWithAI() {
    if (pending.current || submitted) return;
    pending.current = true;
    setAction('ai');
    setError(null);
    setNotice(null);
    try {
      const suggestions = await api<PostSuggestions>('/posts/suggest', { method: 'POST', form: photoForm(photo) });
      setForm(current => ({
        ...current,
        title: current.title.trim() ? current.title : suggestions.title,
        description: current.description.trim() ? current.description : suggestions.description,
        category: current.category || suggestions.category,
        labels: current.labels.trim() ? current.labels : suggestions.labels.join(', '),
      }));
      setNotice('Suggestions added. Edit anything you like.');
    } catch (error: any) {
      setError(`${error.message} You can still publish manually.`);
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  // Reuses the same upload and request ID when a response is lost.
  async function publish() {
    if (pending.current) return;
    pending.current = true;
    setAction('publish');
    setError(null);
    Keyboard.dismiss();
    try {
      if (!upload.current) {
        const data = photoForm(photo);
        if (!form.title.trim()) throw new Error('Add a short title.');
        if (!form.description.trim()) throw new Error('Add a description.');
        if (!form.category) throw new Error('Choose a category.');
        if (!location || !confirmed || !form.placeName.trim()) throw new Error('Choose and confirm a location.');
        if (timing === 'later' && scheduledAt.getTime() <= Date.now()) throw new Error('Choose a future date and time.');
        const labels = form.labels.split(',').map(label => label.trim()).filter(Boolean);
        if (labels.length > 5 || labels.some(label => label.length > 30)) throw new Error('Use up to 5 labels of 30 characters each.');
        requestId.current ||= uuid.v4();
        data.append('requestId', requestId.current);
        data.append('title', form.title.trim());
        data.append('description', form.description.trim());
        data.append('category', form.category);
        data.append('placeName', form.placeName.trim());
        data.append('latitude', String(location.latitude));
        data.append('longitude', String(location.longitude));
        data.append('activityAt', timing === 'now' ? new Date().toISOString() : scheduledAt.toISOString());
        labels.forEach(label => data.append('labels[]', label));
        upload.current = data;
      }
      setSubmitted(true);
      const published = await api<Post>('/posts', { method: 'POST', form: upload.current });
      onPosted(published.id);
    } catch (error: any) {
      setError(error.message);
      if (error instanceof ApiError && error.status === 400) {
        upload.current = null;
        requestId.current = null;
        setSubmitted(false);
      }
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Layout>
        <Title>Share the moment.</Title>
        <View style={{ backgroundColor: C.pale, borderRadius: 20, padding: 12, marginVertical: 16 }}>
          {photo ? <Image
            source={{ uri: photo.uri }}
            style={{ width: '100%', height: 110, borderRadius: 12 }}
            resizeMode="cover"
          /> : <Text style={{ fontSize: 32, textAlign: 'center', padding: 12 }}>📷 Add a photo</Text>}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Btn label="Camera" secondary disabled={locked} onPress={() => void choose(true)} /></View>
            <View style={{ flex: 1 }}><Btn label="Gallery" secondary disabled={locked} onPress={() => void choose(false)} /></View>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={fillWithAI}
          style={{ paddingVertical: 10, marginBottom: 12 }}
        >
          <Text style={{ color: C.green, fontWeight: '700' }}>
            {action === 'ai' ? 'Filling details…' : '✦ Fill details with AI'}
          </Text>
        </Pressable>
        <Field
          label="Title"
          value={form.title}
          maxLength={100}
          editable={!submitted && action !== 'publish'}
          onChangeText={title => setForm(current => ({ ...current, title }))}
          placeholder="What’s happening?"
        />
        <Field
          label="Description"
          value={form.description}
          maxLength={1000}
          multiline
          editable={!submitted && action !== 'publish'}
          onChangeText={description => setForm(current => ({ ...current, description }))}
          placeholder="What can people join?"
        />
        <Select
          label="Category"
          value={form.category}
          options={categories}
          disabled={locked}
          onSelect={category => setForm(current => ({ ...current, category }))}
        />
        <Text style={{ color: C.ink, fontWeight: '700', marginTop: 12 }}>Location</Text>
        {confirmed && !locationOpen ? <Muted style={{ marginTop: 8 }}>📍 {form.placeName}</Muted> : null}
        <Btn
          label={confirmed ? 'Change location' : 'Choose a place'}
          secondary
          disabled={locked}
          onPress={() => setLocationOpen(!locationOpen)}
        />
        {locationOpen ? (
          <View style={{ marginTop: 16 }}>
            <LocationSearch disabled={locked} onSelect={selectLocation} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Btn label="Current area" secondary disabled={locked} onPress={() => selectLocation(center)} />
              </View>
              <View style={{ flex: 1 }}><Btn label="My location" secondary disabled={locked} onPress={useDeviceLocation} /></View>
            </View>
            <View style={{ height: 200, borderRadius: 20, overflow: 'hidden', marginVertical: 12 }}>
              <MapView
                ref={map}
                style={{ flex: 1 }}
                initialRegion={{ ...(location || center), latitudeDelta: 0.03, longitudeDelta: 0.03 }}
                onPress={event => {
                  if (event.nativeEvent.action === 'marker-press') return;
                  selectLocation({ ...event.nativeEvent.coordinate, name: 'Selected map pin', isManual: true });
                }}
              >
                {location ? <Marker coordinate={location} title={form.placeName} pinColor={C.green} /> : null}
              </MapView>
            </View>
            {location ? <Field
              label="Place name"
              value={form.placeName}
              maxLength={150}
              editable={!locked}
              onChangeText={placeName => { setForm(current => ({ ...current, placeName })); setConfirmed(false); }}
              placeholder="Name this place"
            /> : null}
            <Btn
              label="Use this location"
              disabled={locked || !location || !form.placeName.trim()}
              onPress={() => { setConfirmed(true); setLocationOpen(false); }}
            />
          </View>
        ) : null}
        <Text style={{ color: C.ink, fontWeight: '700', marginTop: 22 }}>When?</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginVertical: 12 }}>
          {(['now', 'later'] as const).map(value => (
            <Pressable
              key={value}
              accessibilityRole="button"
              disabled={locked}
              onPress={() => setTiming(value)}
              style={{ backgroundColor: timing === value ? C.ink : C.pale, borderRadius: 24, paddingHorizontal: 22, paddingVertical: 12 }}
            >
              <Text style={{ color: timing === value ? 'white' : C.ink }}>{value === 'now' ? 'Now' : 'Later'}</Text>
            </Pressable>
          ))}
        </View>
        {timing === 'later' && Platform.OS === 'ios' ? <DateTimePicker
          value={scheduledAt}
          mode="datetime"
          display="compact"
          minimumDate={new Date()}
          disabled={locked}
          onValueChange={(_event, date) => setScheduledAt(date)}
        /> : null}
        {timing === 'later' && Platform.OS === 'android' ? <>
          <Btn
            label={scheduledAt.toLocaleString()}
            secondary
            disabled={locked}
            onPress={() => setAndroidPicker('date')}
          />
          {androidPicker ? <DateTimePicker
            value={scheduledAt}
            mode={androidPicker}
            minimumDate={new Date()}
            onDismiss={() => setAndroidPicker(null)}
            onValueChange={(_event, date) => { setScheduledAt(date); setAndroidPicker(androidPicker === 'date' ? 'time' : null); }}
          /> : null}
        </> : null}
        <Text
          accessibilityRole="button"
          onPress={() => setShowLabels(!showLabels)}
          style={{ color: C.green, paddingVertical: 14 }}
        >Labels (optional) {showLabels ? '⌃' : '⌄'}</Text>
        {showLabels ? <Field
          label="Labels"
          value={form.labels}
          editable={!submitted && action !== 'publish'}
          onChangeText={labels => setForm(current => ({ ...current, labels }))}
          placeholder="coffee, outdoors"
        /> : null}
        {notice ? <Muted style={{ color: C.green }}>{notice}</Muted> : null}
        {busy && action !== 'publish' ? <Loading label="Please wait…" /> : null}
      </Layout>
      <View
        style={{ paddingHorizontal: 20, paddingBottom: 12, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.canvas }}
      >
        <ErrorText message={error} />
        {submitted && error ? <Muted>Retry to check or finish this same upload.</Muted> : null}
        <Btn
          label={action === 'publish' ? 'Publishing…' : submitted && error ? 'Retry publishing →' : 'Publish post →'}
          disabled={busy}
          onPress={publish}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
