import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { api, Comment, CommentPage, formatActivityTime, Post, timeAgo } from '../lib/api';
import { Btn, ErrorText, IconButton, LabelChip, Loading, Muted, Title } from '../components/ui';
import { C } from '../theme/theme';
import { LocationCredits } from '../components/LocationSearch';

// Shows an activity and the actions available to the current user.
export function PostDetailScreen({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit?: (id: string) => void }) {
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [commentNotice, setCommentNotice] = useState<string | null>(null);
  const [action, setAction] = useState<'interest' | 'comment' | 'analyze' | 'publish' | null>(null);
  const busy = action !== null;
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const commentsPending = useRef(false);
  const loadVersion = useRef(0);
  const commentRequest = useRef<{ body: string; id: string } | null>(null);

  // Loads a page of comments and the full count without blocking the activity details.
  const loadComments = useCallback(async (offset = 0) => {
    if (commentsPending.current) return;
    commentsPending.current = true;
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const page = await api<CommentPage>(`/comments/${id}?includeTotal=true&offset=${offset}`);
      if (offset === 0) setComments(page.comments);
      else setComments(current => {
        const existing = new Set(current.map(item => item.id));
        return [...current, ...page.comments.filter(item => !existing.has(item.id))];
      });
      setCommentTotal(page.total);
    } catch (error: any) {
      setCommentsError(error.message);
    } finally {
      commentsPending.current = false;
      setCommentsLoading(false);
    }
  }, [id]);

  // Loads the activity first, then retrieves its public conversation separately.
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const loadedPost = await api<Post>(`/posts/${id}`);
      if (version !== loadVersion.current) return;
      setPost(loadedPost);
      if (loadedPost.status === 'PUBLISHED') await loadComments();
    } catch (error: any) {
      if (version === loadVersion.current) {
        if (error.status === 404) setPost(null);
        setError(error.message);
      }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [id, loadComments]);
  useEffect(() => { void load(); }, [load]);

  // Sends interest and reloads the activity’s count and viewer state.
  async function join() {
    if (pending.current) return;
    pending.current = true;
    setAction('interest');
    setError(null);
    try {
      await api(`/interests/${id}`, { method: 'POST' });
      Alert.alert('Interest sent', 'The creator can see you would like to join.');
      await load();
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  // Posts a comment once, reusing its request ID if a failed request is retried.
  async function addComment() {
    if (pending.current || commentsPending.current) return;
    const body = comment.trim();
    if (!body) { setCommentsError('Write a comment first.'); return; }
    if (!commentRequest.current || commentRequest.current.body !== body) {
      commentRequest.current = { body, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    pending.current = true;
    setAction('comment');
    setCommentsError(null);
    setCommentNotice(null);
    try {
      await api(`/comments/${id}`, { method: 'POST', body: { body, clientRequestId: commentRequest.current.id } });
      setComment('');
      commentRequest.current = null;
      setCommentNotice('Comment posted.');
      await loadComments();
    } catch (error: any) {
      setCommentsError(error.message);
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  // Retries photo analysis for an older failed draft.
  async function retry() {
    if (pending.current) return;
    pending.current = true;
    setAction('analyze');
    setError(null);
    try {
      await api(`/posts/${id}/analyze`, { method: 'POST' });
      await load();
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  // Publishes an owned draft that is ready.
  async function publish() {
    if (pending.current) return;
    pending.current = true;
    setAction('publish');
    setError(null);
    try {
      await api(`/posts/${id}/publish`, { method: 'POST' });
      await load();
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setAction(null);
    }
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: C.canvas }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 45 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { if (!pending.current) void load(); }} tintColor={C.green} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <IconButton name="chevron-back" onPress={onBack} />
          <Text style={{ fontWeight: '700', color: C.ink }}>Activity details</Text>
          <View style={{ width: 44 }} />
        </View>
        <ErrorText message={error} />
        {!post && loading ? <Loading /> : null}
        {!post && !loading ? <Btn label="Retry loading activity" secondary onPress={load} /> : null}
        {post ? (
          <>
            {post.imageUrl ? (
              <Image
                source={{ uri: post.imageUrl }}
                style={{ marginTop: 20, width: '100%', height: 225, borderRadius: 22 }}
              />
            ) : null}
            <View style={{ alignSelf: 'flex-start', marginTop: 20 }}>
              <LabelChip text={post.category || post.status} />
            </View>
            <Title>
              {post.title || 'AI analysis in progress'}
            </Title>
            <Muted>👤 Posted by {post.creatorName} · {timeAgo(post.published_at || post.created_at)}
            </Muted>
            <Text style={{ color: C.ink, marginTop: 20, fontSize: 15, lineHeight: 24 }}>
              {post.description || 'The photo is being processed.'}
            </Text>
            <Text style={{ marginTop: 22, color: C.ink, fontWeight: '700' }}>📍 {post.place_name}
            </Text>
            <LocationCredits />
            <Muted style={{ marginTop: 9 }}>🕒 {formatActivityTime(post.activity_at)}</Muted>
            <Muted style={{ marginTop: 6 }}>
              {post.status === 'PUBLISHED' ? 'Confirm current details with the creator.' : `Status: ${post.status}`}
            </Muted>
            {post.isOwn && post.status !== 'ANALYZING' && onEdit ? <Btn label="Edit activity" secondary disabled={busy} onPress={() => onEdit(post.id)} /> : null}
            {post.isOwn && post.status === 'FAILED'
              ? <Btn label={action === 'analyze' ? 'Retrying…' : 'Retry AI analysis'} onPress={retry} disabled={busy} />
              : null}
            {post.isOwn && post.status === 'READY' ? <Btn label="Confirm and publish" onPress={publish} disabled={busy} /> : null}
            {post.isOwn ? <Muted style={{ color: C.green, marginTop: 14 }}>{post.interestCount} interested</Muted> : null}
            {!post.isOwn && post.status === 'PUBLISHED' ? (
              <Btn
                label={post.interested ? `Interested ✓ · ${post.interestCount}` : action === 'interest' ? `Sending… · ${post.interestCount}` : `Let’s Go · ${post.interestCount}`}
                disabled={busy || post.interested}
                onPress={join}
                lime
              />
            ) : null}
            {!post.isOwn && post.status === 'PUBLISHED'
              ? <Muted style={{ textAlign: 'center', marginTop: 7 }}>We’ll notify the creator in their Activity inbox.</Muted>
              : null}
            {post.status === 'PUBLISHED' ? (
              <View style={{ marginTop: 28, borderTopColor: C.border, borderTopWidth: 1, paddingTop: 20 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink }}>Comments ({commentTotal})</Text>
                <Muted>Public · Visible to everyone who can view this post. Newest first.</Muted>
                <ErrorText message={commentsError} />
                {commentNotice ? <Muted style={{ color: C.green, marginTop: 10 }}>{commentNotice}</Muted> : null}
                <Text
                  onPress={() => { if (!pending.current) void loadComments(); }}
                  style={{ color: C.green, marginTop: 12 }}
                >Refresh comments ↻</Text>
                {commentsLoading ? <Loading label="Loading comments…" /> : null}
                {!commentsLoading && !commentsError && comments.length === 0 ? <Muted style={{ marginTop: 16 }}>No comments yet. Start the conversation.</Muted> : null}
                {comments.map(commentItem => (
                  <View key={commentItem.id} style={{ borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 14 }}>
                    <Text style={{ fontWeight: '700', color: C.ink }}>
                      {commentItem.authorName}
                    </Text>
                    <Muted>
                      {timeAgo(commentItem.created_at)}
                    </Muted>
                    <Text style={{ marginTop: 6, color: C.ink }}>
                      {commentItem.body}
                    </Text>
                  </View>
                ))}
                {comments.length < commentTotal ? <Btn
                  label="Load more comments"
                  secondary
                  disabled={commentsLoading || busy}
                  onPress={() => void loadComments(comments.length)}
                /> : null}
                <TextInput
                  multiline
                  editable={!busy}
                  value={comment}
                  onChangeText={setComment}
                  maxLength={500}
                  placeholder="Ask a question or join the conversation…"
                  style={{
                    marginTop: 18,
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: 12,
                    padding: 13,
                    backgroundColor: 'white',
                    minHeight: 80,
                    textAlignVertical: 'top'
                  }}
                />
                <Btn
                  label={action === 'comment' ? 'Posting…' : 'Post comment'}
                  onPress={addComment}
                  disabled={busy || commentsLoading || !comment.trim()}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
