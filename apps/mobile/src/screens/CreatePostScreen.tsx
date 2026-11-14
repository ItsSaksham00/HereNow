import React, { useState } from 'react';
import { Alert, Image, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { api, Post } from '../lib/api';
import { Btn, ErrorText, LabelChip, Layout, Loading, Muted, Title } from '../components/ui';
import { C } from '../theme/theme';

export function CreatePostScreen({ onPosted }: { onPosted: (id: string) => void }) {
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [preview, setPreview] = useState<Post | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string|null>(null);
  async function choose(camera: boolean) {
    setError(null);
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError('Photo permission denied. You can grant it in device settings.'); return; }
    const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
    if (!result.canceled && result.assets[0]) { setPhoto(result.assets[0]); setPreview(null); }
  }
  async function generate() {
    if (!photo) { setError('Choose or take a photo first.'); return; }
    setBusy(true); setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Location access is required to automatically place your activity.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      // Approximate coordinates avoid exposing exact user location. Consider user-editable venue choice later.
      const latitude = Number(pos.coords.latitude.toFixed(3)); const longitude = Number(pos.coords.longitude.toFixed(3));
      const addresses = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
      const a = addresses[0];
      const placeName = [a?.name, a?.city || a?.district].filter(Boolean).join(', ') || 'Approximate device location';
      const form = new FormData();
      form.append('latitude', String(latitude)); form.append('longitude', String(longitude)); form.append('placeName', placeName);
      form.append('photo', { uri: photo.uri, name: photo.fileName || `activity.${(photo.mimeType || 'image/jpeg').split('/')[1]}`, type: photo.mimeType || 'image/jpeg' } as any);
      const post = await api<Post>('/posts', { method: 'POST', form });
      setPreview(post);
    } catch (e:any) { setError(e.message); } finally { setBusy(false); }
  }
  async function publish() {
    if (!preview) return;
    setBusy(true); setError(null);
    try { const published = await api<Post>(`/posts/${preview.id}/publish`, { method: 'POST' }); onPosted(published.id); }
    catch (e:any) { setError(e.message); } finally { setBusy(false); }
  }
  return <Layout><Title>Share the moment.</Title><Muted>Take a photo or choose from your gallery. AI suggests the title and description; you approve before publishing.</Muted>
    <View style={{ backgroundColor: '#EEF2E7', borderWidth: 1, borderStyle: 'dashed', borderColor: '#B8C8AE', borderRadius: 20, marginTop: 20, padding: 18, alignItems: 'center' }}>
      {photo ? <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 180, borderRadius: 12 }} resizeMode="cover"/> : <Text style={{ fontSize: 46 }}>📷</Text>}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}><View style={{ flex: 1 }}><Btn label="Camera" secondary onPress={() => void choose(true)}/></View><View style={{ flex: 1 }}><Btn label="Gallery" secondary onPress={() => void choose(false)}/></View></View>
    </View>
    {preview ? <View style={{ backgroundColor: 'white', borderRadius: 19, borderColor: C.border, borderWidth: 1, padding: 17, marginTop: 20 }}>
      <Text style={{ color: C.green, fontWeight: '700' }}>✦ AI-generated preview</Text>
      <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, marginTop: 10 }}>{preview.title}</Text>
      <Text style={{ color: C.muted, marginVertical: 12 }}>{preview.description}</Text>
      <LabelChip text={preview.category || 'Other'}/>
      <Muted style={{ marginTop: 12 }}>📍 {preview.place_name} · Approximate location visible to others</Muted>
      <Muted style={{ marginTop: 10 }}>AI descriptions are suggestions, not proof of a live event. Confirm that this activity is genuinely happening now.</Muted>
    </View> : null}
    <ErrorText message={error}/>
    {busy ? <Loading label="Processing your activity…"/> : preview ? <><Btn label="Confirm & publish →" onPress={publish}/><Btn label="Retake photo" secondary onPress={() => { setPreview(null); setPhoto(null); }}/></> : <Btn label="✦ Generate activity with AI" disabled={!photo} onPress={generate}/>}
    <Muted style={{ marginTop: 18 }}>Posts expire automatically after a few hours. If analysis fails, retry from My Posts.</Muted>
  </Layout>;
}
