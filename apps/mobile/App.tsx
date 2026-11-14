import React, { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase';
import { api } from './src/lib/api';
import { AuthScreen } from './src/screens/AuthScreen';
import { Center, LocationScreen } from './src/screens/LocationScreen';
import { FeedScreen } from './src/screens/FeedScreen';
import { MapScreen } from './src/screens/MapScreen';
import { PostDetailScreen } from './src/screens/PostDetailScreen';
import { CreatePostScreen } from './src/screens/CreatePostScreen';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { C } from './src/theme/theme';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// Keeps the app in sync with the current authentication session.
function AppContent() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    const appListener = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh();
    });
    return () => {
      authListener.subscription.unsubscribe();
      appListener.remove();
    };
  }, []);
  useEffect(() => {
    if (session) void api('/users/me', { method: 'POST' }).catch(error => console.warn('Profile sync failed:', error));
  }, [session?.user.id]);
  if (session === undefined) return <View style={{ flex: 1, backgroundColor: C.canvas }} />;
  if (!session) return <AuthScreen />;
  return <SignedIn key={session.user.id} />;
}

type Tab = 'feed' | 'create' | 'activity' | 'profile';

// Shows the selected screen and handles navigation for a signed-in user.
function SignedIn() {
  const [center, setCenter] = useState<Center | null>(null);
  const [tab, setTab] = useState<Tab>('feed');
  const [postId, setPostId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [radius, setRadius] = useState(10);
  if (!center) return <LocationScreen onSelected={setCenter} />;

  // Opens an activity and closes the map.
  const openPost = (id: string) => {
    setPostId(id);
    setShowMap(false);
  };
  let content: React.ReactNode;
  if (postId) content = <PostDetailScreen key={postId} id={postId} onBack={() => setPostId(null)} />;
  else if (showMap) content = <MapScreen
    center={center}
    radius={radius}
    onRadiusChange={setRadius}
    onBack={() => setShowMap(false)}
    onPost={openPost}
    onSelect={(next, nextRadius) => {
      setCenter(next);
      setRadius(nextRadius);
      setShowMap(false);
      setTab('feed');
    }} />;
  else if (tab === 'feed') content = <FeedScreen
    center={center}
    radius={radius}
    onRadiusChange={setRadius}
    onMap={() => setShowMap(true)}
    onLocation={() => setCenter(null)}
    onPost={openPost}
  />;
  else if (tab === 'create') content = <CreatePostScreen center={center} onPosted={openPost} />;
  else if (tab === 'activity') content = <ActivityScreen onPost={openPost} />;
  else content = <ProfileScreen onPost={openPost} onChangeLocation={() => setCenter(null)} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <View style={{ flex: 1 }}>
        {content}
      </View>
      {!postId && !showMap ? (
        <View style={styles.nav}>
          {([
            ['feed', 'home-outline', 'Nearby'], ['create', 'add-circle-outline', 'Post'], ['activity', 'notifications-outline', 'Activity'], ['profile', 'person-outline', 'Profile']
          ] as [Tab, React.ComponentProps<typeof Ionicons>['name'], string][]).map(([key, icon, label]) => (
            <Pressable key={key} onPress={() => setTab(key)} style={styles.navItem}>
              <Ionicons name={icon} color={tab === key ? C.green : C.muted} size={23} />
              <Text
                style={{
                  fontSize: 11,
                  color: tab === key ? C.green : C.muted,
                  fontWeight: tab === key ? '800' : '500'
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    borderTopWidth: 1,
    borderColor: C.border,
    backgroundColor: C.canvas,
    flexDirection: 'row',
    paddingTop: 11,
    paddingBottom: 10,
    justifyContent: 'space-around'
  },
  navItem: { minWidth: 62, alignItems: 'center', gap: 4, padding: 4 }
});

// Applies safe-area spacing once, including screens that do not use Layout.
export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }}>
        <StatusBar style="dark" />
        <AppContent />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
