import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { api, Post, Profile } from '../lib/api';
import { Btn, ErrorText, Layout, Loading, Muted, Title } from '../components/ui';
import { supabase } from '../lib/supabase';
import { C } from '../theme/theme';

export function ProfileScreen({ onPost, onChangeLocation }: { onPost: (id:string) => void; onChangeLocation: () => void }) {
  const [profile, setProfile] = useState<Profile|null>(null); const [mine, setMine] = useState<Post[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string|null>(null);
  async function load() { try { const [p, posts] = await Promise.all([api<Profile>('/users/me'), api<Post[]>('/posts/mine')]); setProfile(p); setMine(posts); } catch (e:any) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  async function deletePost(id: string) {
    Alert.alert('Delete activity?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await api(`/posts/${id}`, { method: 'DELETE' }); await load(); } catch (e:any) { setError(e.message); } } }]);
  }
  return <Layout><Title>Your corner.</Title>{loading ? <Loading/> : <>
    <View style={{ alignItems: 'center', paddingVertical: 20 }}><View style={{ backgroundColor: C.lime, width: 70, height: 70, borderRadius: 35, justifyContent: 'center', alignItems: 'center' }}><Text style={{ fontSize: 28, color: C.ink, fontWeight: '800' }}>{profile?.display_name?.[0]?.toUpperCase() || 'H'}</Text></View>
      <Text style={{ fontSize: 22, fontWeight: '800', marginTop: 14, color: C.ink }}>{profile?.display_name || 'HereNow member'}</Text></View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: C.border, paddingVertical: 20 }}><View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>Push notifications preference</Text><Muted>Push delivery is not yet enabled; in-app alerts remain available.</Muted></View><Switch value={!!profile?.push_enabled} onValueChange={async value => { if (!profile) return; try { const next = await api<Profile>('/users/me', { method: 'PATCH', body: { displayName: profile.display_name, pushEnabled: value } }); setProfile(next); } catch (e:any) { setError(e.message); } }} trackColor={{ true: C.green }}/></View>
    <Btn label="Location settings" secondary onPress={onChangeLocation}/>
    <Text style={{ fontWeight: '800', color: C.ink, fontSize: 20, marginTop: 30 }}>My posts ({mine.length})</Text>
    {mine.length === 0 ? <Muted style={{ marginTop: 14 }}>You haven’t posted anything yet.</Muted> : mine.map(p => <View key={p.id} style={{ backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 15, marginTop: 12 }}><Pressable onPress={() => onPost(p.id)}><Text style={{ color: C.ink, fontWeight: '800' }}>{p.title || 'Processing photo…'}</Text><Muted>{p.status} · {p.place_name}</Muted><Text style={{ color: C.green, marginTop: 7 }}>View →</Text></Pressable><Text onPress={() => void deletePost(p.id)} style={{ color: C.coral, marginTop: 12 }}>Delete post</Text></View>)}
    <ErrorText message={error}/><Btn label="Log out" secondary style={{ marginTop: 28 }} onPress={() => void supabase.auth.signOut()}/>
  </>}</Layout>;
}
