import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, Notification, timeAgo } from '../lib/api';
import { ErrorText, Layout, Loading, Muted, Title } from '../components/ui';
import { C } from '../theme/theme';

// Shows notifications about the user’s activities.
export function ActivityScreen({ onPost }: { onPost: (id: string) => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Loads the latest notifications and updates the inbox state.
  async function load() {
    try {
      setNotifications(await api<Notification[]>('/notifications'));
      setError(null);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <Layout>
      <Title>Your activity.</Title>
      <Muted>People and plans, all in one place.</Muted>
      <Text onPress={() => void load()} style={{ color: C.green, marginTop: 20, fontWeight: '700' }}>Refresh inbox ↻</Text>
      <ErrorText message={error} />
      {loading ? <Loading /> : notifications.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 70 }}>
          <Text style={{ fontSize: 48 }}>🔔</Text>
          <Muted style={{ marginTop: 15 }}>No notifications yet. When someone taps Let’s Go on your activity, you’ll see it here.</Muted>
        </View>
      ) : notifications.map(notification => (
        <Pressable
          onPress={async () => {
            await api(`/notifications/${notification.id}/read`, { method: 'PATCH' });
            onPost(notification.post_id);
          }}
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
