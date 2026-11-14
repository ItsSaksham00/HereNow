import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, Notification, timeAgo } from '../lib/api';
import { ErrorText, Layout, Loading, Muted, Title } from '../components/ui';
import { C } from '../theme/theme';

export function ActivityScreen({ onPost }: { onPost: (id: string) => void }) {
  const [items, setItems] = useState<Notification[]>([]); const [error, setError] = useState<string|null>(null); const [loading, setLoading] = useState(true);
  async function load() { try { setItems(await api<Notification[]>('/notifications')); setError(null); } catch (e:any) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  return <Layout><Title>Your activity.</Title><Muted>People and plans, all in one place.</Muted>
    <Text onPress={() => void load()} style={{ color: C.green, marginTop: 20, fontWeight: '700' }}>Refresh inbox ↻</Text>
    <ErrorText message={error}/>{loading ? <Loading/> : items.length === 0 ? <View style={{ alignItems: 'center', paddingVertical: 70 }}><Text style={{ fontSize: 48 }}>🔔</Text><Muted style={{ marginTop: 15 }}>No notifications yet. When someone taps Let’s Go on your activity, you’ll see it here.</Muted></View> : items.map(n => <Pressable onPress={async () => { await api(`/notifications/${n.id}/read`, { method: 'PATCH' }); onPost(n.post_id); }} key={n.id} style={{ flexDirection: 'row', paddingVertical: 18, borderBottomWidth: 1, borderColor: C.border, gap: 12 }}>
      <Text style={{ fontSize: 27 }}>💚</Text><View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: n.is_read ? '400' : '700' }}>{n.message}</Text><Muted>{timeAgo(n.created_at)}</Muted><Text style={{ color: C.green, marginTop: 7 }}>View activity →</Text></View>
    </Pressable>)}
    <Muted style={{ marginTop: 22 }}>In-app alerts work now. Optional device push alerts are planned for a later phase.</Muted>
  </Layout>;
}
