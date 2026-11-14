import { BadRequestException, Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { AddCommentDto } from '../common/dtos';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('comments')
export class CommentsController {
  constructor(private readonly db: SupabaseService) {}

  // Lists comments and author names for an available activity.
  @Get(':postId')
  async list(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query('includeTotal') includeTotal?: string,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number = 0
  ) {
    if (offset < 0) throw new BadRequestException('Comment offset must be zero or greater');
    const { data: post, error: postError } = await this.db.client.from('posts').select('status,expires_at').eq('id', postId).maybeSingle();
    this.db.check(postError);
    if (!post || post.status !== 'PUBLISHED' || new Date(post.expires_at).getTime() <= Date.now()) throw new BadRequestException('Activity unavailable');
    const { data, error, count } = await this.db.client
      .from('comments')
      .select('*', { count: 'exact' })
      .eq('post_id', postId)
      .order('created_at', { ascending: includeTotal !== 'true' }).order('id', { ascending: includeTotal !== 'true' })
      .range(offset, offset + 99);
    this.db.check(error);
    const authorIds = [...new Set((data || []).map(comment => comment.author_id))];
    if (!authorIds.length) {
      if (includeTotal === 'true') return { comments: [], total: count || 0 };
      return [];
    }
    const { data: profiles, error: profileError } = await this.db.client.from('profiles').select('id,display_name').in('id', authorIds);
    this.db.check(profileError);
    const authorNames = new Map((profiles || []).map(profile => [profile.id, profile.display_name]));
    const comments = (data || []).map(comment => ({ ...comment, authorName: authorNames.get(comment.author_id) || 'Member' }));
    if (includeTotal === 'true') return { comments, total: count || 0 };
    return comments;
  }

  // Adds a comment to an available activity.
  @Post(':postId')
  async add(
    @Req() request: AuthRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() body: AddCommentDto
  ) {
    if (!body.body.trim()) throw new BadRequestException('Comment cannot be empty');
    const { data: post, error: postError } = await this.db.client.from('posts').select('status,expires_at').eq('id', postId).maybeSingle();
    this.db.check(postError);
    if (!post || post.status !== 'PUBLISHED' || new Date(post.expires_at).getTime() <= Date.now()) throw new BadRequestException('Activity unavailable');
    const comment = { post_id: postId, author_id: request.userId, body: body.body.trim() };
    if (body.clientRequestId) {
      const { data, error } = await this.db.client.from('comments')
        .upsert({ ...comment, client_request_id: body.clientRequestId }, {
          onConflict: 'author_id,client_request_id', ignoreDuplicates: true,
        }).select('*').maybeSingle();
      this.db.check(error);
      if (data) return data;

      // A retry returns the original comment without changing its text or timestamp.
      const existing = await this.db.client.from('comments').select('*')
        .eq('author_id', request.userId).eq('client_request_id', body.clientRequestId)
        .eq('post_id', postId).maybeSingle();
      this.db.check(existing.error);
      if (!existing.data) throw new BadRequestException('This comment request was already used for another activity');
      return existing.data;
    }

    const { data, error } = await this.db.client.from('comments').insert(comment).select('*').single();
    this.db.check(error);
    return data;
  }
}
