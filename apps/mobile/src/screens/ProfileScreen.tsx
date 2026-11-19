import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, Switch, Text, View } from 'react-native';
import { api, formatActivityTime, Post, Profile } from '../lib/api';
import { Btn, ErrorText, Field, Layout, Loading, Muted, Title } from '../components/ui';
import { supabase } from '../lib/supabase';
import { C } from '../theme/theme';

const filters = ['active', 'upcoming', 'expired', 'all'] as const;
type PostFilter = typeof filters[number];
const pageSize = 20;

// Shows expiration from the saved deadline, even before a background status update.
export function ownPostStatus(post: Post, now = Date.now()) {
  if (post.status === 'EXPIRED' || (post.expires_at && new Date(post.expires_at).getTime() <= now)) return 'Expired';
  if (post.status === 'PUBLISHED') {
    if (post.activity_at && new Date(post.activity_at).getTime() > now) return 'Upcoming';
    return 'Active';
  }
  if (post.status === 'READY') return 'Ready';
  if (post.status === 'FAILED') return 'Failed';
  return 'Processing';
}

// Keeps account settings and a paged list of the signed-in user's activities together.
export function ProfileScreen({ onPost, onEdit, onChangeLocation }: {
  onPost: (id: string) => void;
  onEdit: (id: string) => void;
  onChangeLocation: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<PostFilter>('active');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteRetry, setDeleteRetry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const loadVersion = useRef(0);
  const morePending = useRef(false);

  // Refreshes profile statistics and the first matching page, ignoring older filter requests.
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    setPosts([]);
    setHasMore(false);
    try {
      const [account, page] = await Promise.all([
        api<Profile>('/users/me'), api<Post[]>(`/posts/mine?filter=${filter}&limit=${pageSize}&offset=0`),
      ]);
      if (version !== loadVersion.current) return;
      setProfile(account);
      setPosts(page);
      setNextOffset(page.length);
      setHasMore(page.length === pageSize);
    } catch (error: any) {
      if (version === loadVersion.current) setError(error.message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [filter]);
  useEffect(() => {
    void load();
    return () => { loadVersion.current++; };
  }, [load]);

  // Appends the next page without replacing newer results after a filter change.
  async function loadMore() {
    if (morePending.current || loading || !hasMore) return;
    const version = loadVersion.current;
    morePending.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api<Post[]>(`/posts/mine?filter=${filter}&limit=${pageSize}&offset=${nextOffset}`);
      if (version !== loadVersion.current) return;
      setPosts(current => {
        const ids = new Set(current.map(post => post.id));
        return [...current, ...page.filter(post => !ids.has(post.id))];
      });
      setNextOffset(nextOffset + page.length);
      setHasMore(page.length === pageSize);
    } catch (error: any) {
      if (version === loadVersion.current) setError(error.message);
    } finally {
      morePending.current = false;
      setLoadingMore(false);
    }
  }

  // Saves only the account fields supplied by this action.
  async function saveProfile(changes: { displayName: string; bio?: string; pushEnabled?: boolean }) {
    if (pending.current || loading) return;
    if (!changes.displayName.trim()) { setError('Enter a display name.'); return; }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Profile>('/users/me', { method: 'PATCH', body: changes });
      setProfile(updated);
      if (changes.bio !== undefined) setEditing(false);
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  // Deletes only after confirmation and reloads the list and exact account count.
  function deletePost(id: string) {
    Alert.alert('Delete this activity?', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError(null);
        try {
          await api(`/posts/${id}`, { method: 'DELETE' });
          setDeleteRetry(null);
          await load();
        } catch (error: any) {
          setDeleteRetry(id);
          setError(error.message);
        } finally {
          pending.current = false;
          setBusy(false);
        }
      } },
    ]);
  }

  // Clears the persisted session and shows sign-out failures without hiding the account screen.
  async function logOut() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Layout refreshing={loading} onRefresh={() => { if (!pending.current) void load(); }}>
        <Title>Your corner.</Title>
        {profile ? <>
          <View style={{ alignItems: 'center', paddingVertical: 20 }}>
            <View style={{ backgroundColor: C.lime, width: 70, height: 70, borderRadius: 35, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontSize: 28, color: C.ink, fontWeight: '800' }}>{profile.display_name.trim()[0]?.toUpperCase() || 'H'}</Text>
            </View>
            <Text style={{ fontSize: 22, fontWeight: '800', marginTop: 14, color: C.ink }}>{profile.display_name}</Text>
            <Muted style={{ marginTop: 5 }}>{profile.email}</Muted>
            {profile.bio ? <Muted style={{ marginTop: 10, textAlign: 'center' }}>{profile.bio}</Muted> : null}
            <Text style={{ color: C.green, marginTop: 12, fontWeight: '700' }}>{profile.postCount} posts created</Text>
          </View>
        </> : null}
        <Text style={{ fontWeight: '800', color: C.ink, fontSize: 20, marginTop: 12 }}>My Posts</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 14 }}>
          {filters.map(value => <Pressable key={value} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: filter === value }}
            onPress={() => setFilter(value)} style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 24, backgroundColor: filter === value ? C.ink : C.border }}>
            <Text style={{ color: filter === value ? 'white' : C.muted, fontSize: 12 }}>{value[0].toUpperCase() + value.slice(1)}</Text>
          </Pressable>)}
        </View>
        {loading ? <Loading /> : !error && posts.length === 0 ? <Muted>No {filter === 'all' ? '' : `${filter} `}activities yet.</Muted> : null}
        {posts.map(post => <View key={post.id} style={{ backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 12 }}>
          <Pressable onPress={() => onPost(post.id)} style={{ flexDirection: 'row', gap: 12 }}>
            {post.imageUrl ? <Image source={{ uri: post.imageUrl }} style={{ width: 70, height: 76, borderRadius: 12 }} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.ink, fontWeight: '800' }}>{post.title || 'Untitled activity'}</Text>
              <Muted>{post.place_name}</Muted>
              <Muted>{formatActivityTime(post.activity_at)}</Muted>
              <Text style={{ color: C.green, fontSize: 12, marginTop: 5 }}>{ownPostStatus(post)} · {post.interestCount} interested</Text>
            </View>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 24, marginTop: 12 }}>
            <Text accessibilityRole="button" disabled={busy || post.status === 'ANALYZING'} onPress={() => onEdit(post.id)} style={{ color: C.green }}>Edit</Text>
            <Text accessibilityRole="button" disabled={busy} onPress={() => deletePost(post.id)} style={{ color: C.coral }}>Delete</Text>
          </View>
        </View>)}
        {hasMore ? <Btn label={loadingMore ? 'Loading…' : 'Load more posts'} secondary disabled={loadingMore || busy || loading} onPress={loadMore} /> : null}
        <ErrorText message={error} />
        {deleteRetry ? <Btn label="Retry deleting" secondary disabled={busy} onPress={() => deletePost(deleteRetry)} /> : null}
        {error ? <Btn label="Retry loading" secondary disabled={busy} onPress={load} /> : null}
        {profile ? <>
          <Btn label={editing ? 'Cancel editing profile' : 'Edit Profile'} secondary disabled={busy || loading} onPress={() => {
            setDisplayName(profile.display_name); setBio(profile.bio || ''); setEditing(!editing); setError(null);
          }} />
          {editing ? <View style={{ marginTop: 16 }}>
            <Field label="Display name" value={displayName} maxLength={60} editable={!busy} onChangeText={setDisplayName} />
            <Field label="Bio (optional)" value={bio} maxLength={300} multiline editable={!busy} onChangeText={setBio} />
            <Btn label={busy ? 'Saving…' : 'Save profile'} disabled={busy || loading} onPress={() => void saveProfile({ displayName: displayName.trim(), bio: bio.trim() })} />
          </View> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderColor: C.border, paddingVertical: 20, marginTop: 20 }}>
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700' }}>Push notifications preference</Text>
              <Muted>Push delivery is not yet enabled; in-app alerts remain available.</Muted></View>
            <Switch value={profile.push_enabled} disabled={busy || loading} trackColor={{ true: C.green }}
              onValueChange={value => void saveProfile({ displayName: profile.display_name, pushEnabled: value })} />
          </View>
        </> : null}
        <Btn label="Location settings" secondary disabled={busy} onPress={onChangeLocation} />
        <Btn label={busy ? 'Please wait…' : 'Log out'} secondary disabled={busy} style={{ marginTop: 24 }} onPress={logOut} />
      </Layout>
    </KeyboardAvoidingView>
  );
}
