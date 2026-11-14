import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api, Comment, Post, timeAgo } from '../lib/api';
import { Btn, ErrorText, IconButton, LabelChip, Loading, Muted, Title } from '../components/ui';
import { C } from '../theme/theme';

export function PostDetailScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const [post, setPost] = useState<Post|null>(null); const [comments, setComments] = useState<Comment[]>([]);
  const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string|null>(null);
  const load = useCallback(async () => {
    try { const p = await api<Post>(`/posts/${id}`); setPost(p); if (p.status === 'PUBLISHED') setComments(await api<Comment[]>(`/comments/${id}`)); setError(null); }
    catch (e:any) { setError(e.message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function join() {
    setBusy(true); try { await api(`/interests/${id}`, { method: 'POST' }); Alert.alert('Interest sent', 'The creator can see you would like to join.'); await load(); }
    catch (e:any) { setError(e.message); } finally { setBusy(false); }
  }
  async function addComment() {
    if (!comment.trim()) return;
    setBusy(true); try { await api(`/comments/${id}`, { method: 'POST', body: { body: comment.trim() } }); setComment(''); await load(); }
    catch (e:any) { setError(e.message); } finally { setBusy(false); }
  }
  async function retry() {
    setBusy(true); try { await api(`/posts/${id}/analyze`, { method: 'POST' }); await load(); }
    catch (e:any) { setError(e.message); } finally { setBusy(false); }
  }
  async function publish() {
    setBusy(true); try { await api(`/posts/${id}/publish`, { method: 'POST' }); await load(); }
    catch (e:any) { setError(e.message); } finally { setBusy(false); }
  }
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.canvas }}>
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 45 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><IconButton name="chevron-back" onPress={onBack}/><Text style={{ fontWeight: '700', color: C.ink }}>Activity details</Text><View style={{ width: 44 }}/></View>
      <ErrorText message={error}/>
      {!post ? <Loading/> : <>
        {post.imageUrl ? <Image source={{ uri: post.imageUrl }} style={{ marginTop: 20, width: '100%', height: 225, borderRadius: 22 }} /> : null}
        <View style={{ alignSelf: 'flex-start', marginTop: 20 }}><LabelChip text={post.category || post.status}/></View>
        <Title>{post.title || 'AI analysis in progress'}</Title>
        <Muted>👤 Posted by {post.creatorName} · {timeAgo(post.published_at || post.created_at)}</Muted>
        <Text style={{ color: C.ink, marginTop: 20, fontSize: 15, lineHeight: 24 }}>{post.description || 'The photo is being processed.'}</Text>
        <Text style={{ marginTop: 22, color: C.ink, fontWeight: '700' }}>📍 {post.place_name}</Text>
        <Muted style={{ marginTop: 9 }}>🕒 {post.status === 'PUBLISHED' ? 'Published activity — confirm current details with the creator.' : `Status: ${post.status}`}</Muted>
        {post.isOwn && post.status === 'FAILED' ? <Btn label={busy ? 'Retrying…' : 'Retry AI analysis'} onPress={retry} disabled={busy}/> : null}
        {post.isOwn && post.status === 'READY' ? <Btn label="Confirm and publish" onPress={publish} disabled={busy}/> : null}
        {!post.isOwn && post.status === 'PUBLISHED' ? <Btn label={post.interested ? '✓ Interest already sent' : busy ? 'Sending…' : 'Let’s Go →'} disabled={busy || post.interested} onPress={join} lime/ > : null}
        {!post.isOwn && post.status === 'PUBLISHED' ? <Muted style={{ textAlign: 'center', marginTop: 7 }}>We’ll notify the creator in their Activity inbox.</Muted> : null}
        {post.status === 'PUBLISHED' ? <View style={{ marginTop: 28, borderTopColor: C.border, borderTopWidth: 1, paddingTop: 20 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink }}>Comments ({comments.length})</Text>
          <Muted>Public · Visible to everyone who can view this post.</Muted>
          {comments.map(c => <View key={c.id} style={{ borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 14 }}><Text style={{ fontWeight: '700', color: C.ink }}>{c.authorName}</Text><Muted>{timeAgo(c.created_at)}</Muted><Text style={{ marginTop: 6, color: C.ink }}>{c.body}</Text></View>)}
          <TextInput multiline value={comment} onChangeText={setComment} maxLength={500} placeholder="Ask a question or join the conversation…" style={{ marginTop: 18, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, backgroundColor: 'white', minHeight: 80, textAlignVertical: 'top' }}/>
          <Btn label={busy ? 'Posting…' : 'Post comment'} onPress={addComment} disabled={busy || !comment.trim()}/>
        </View> : null}
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
