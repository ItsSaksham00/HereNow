import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, Notification, timeAgo } from '../lib/api';
import { ErrorText, Layout, Loading, Muted, Title } from '../components/ui';
import { C } from '../theme/theme';

// Shows notifications about the user’s activities.
export function ActivityScreen({ onPost }: { onPost: (id: string) => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const loadPending = useRef(false);
  const openPending = useRef(false);

  // Loads the latest notifications and updates the inbox state.
  async function load() {
    if (loadPending.current) return;
    loadPending.current = true;
    setLoading(true);
    try {
      setNotifications(await api<Notification[]>('/notifications'));
      setError(null);
    } catch (error: any) {
      setError(error.message);
    } finally {
      loadPending.current = false;
      setLoading(false);
    }
  }

  // Saves the read flag before opening the activity and keeps failures retryable.
  async function openNotification(notification: Notification) {
    if (openPending.current) return;
    openPending.current = true;
    setOpening(true);
    setError(null);
    try {
      if (!notification.is_read) {
        const result = await api<{ id: string; is_read: boolean }>(`/notifications/${notification.id}/read`, { method: 'PATCH' });
        if (!result.is_read) throw new Error('This notification is no longer available. Refresh your inbox.');
        setNotifications(current => current.map(item => item.id === notification.id ? { ...item, is_read: true } : item));
      }
      onPost(notification.post_id);
    } catch (error: any) {
      setError(error.message);
    } finally {
      openPending.current = false;
      setOpening(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <Layout refreshing={loading} onRefresh={load}>
      <Title>Your activity.</Title>
      <Muted>People and plans, all in one place.</Muted>
      <Text onPress={() => void load()} style={{ color: C.green, marginTop: 20, fontWeight: '700' }}>Refresh inbox ↻</Text>
      <ErrorText message={error} />
      {loading && notifications.length === 0 ? <Loading /> : notifications.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 70 }}>
          <Text style={{ fontSize: 48 }}>🔔</Text>
          <Muted style={{ marginTop: 15 }}>No notifications yet. When someone taps Let’s Go on your activity, you’ll see it here.</Muted>
        </View>
      ) : notifications.map(notification => (
        <Pressable
          disabled={opening}
          onPress={() => void openNotification(notification)}
          key={notification.id}
          style={{
            flexDirection: 'row',
            paddingVertical: 18,
            borderBottomWidth: 1,
            borderColor: C.border,
            gap: 12
          }}
        >
          <Text style={{ fontSize: 27 }}>💚</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, fontWeight: notification.is_read ? '400' : '700' }}>
              {notification.message}
            </Text>
            <Muted>
              {timeAgo(notification.created_at)}
            </Muted>
            <Text style={{ color: C.green, marginTop: 7 }}>View activity →</Text>
          </View>
        </Pressable>
      ))}
      <Muted style={{ marginTop: 22 }}>In-app alerts work now. Optional device push alerts are planned for a later phase.</Muted>
    </Layout>
  );
}
