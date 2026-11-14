import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { AddCommentDto } from '../common/dtos';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('comments')
export class CommentsController {
  constructor(private readonly db: SupabaseService) {}
  @Get(':postId')
  async list(@Param('postId', ParseUUIDPipe) postId: string) {
    const { data: post, error: postError } = await this.db.client.from('posts').select('status,expires_at').eq('id', postId).maybeSingle();
    this.db.check(postError);
    if (!post || post.status !== 'PUBLISHED' || new Date(post.expires_at).getTime() < Date.now()) throw new BadRequestException('Activity unavailable');
    const { data, error } = await this.db.client.from('comments').select('*').eq('post_id', postId).order('created_at', { ascending: true }).limit(100);
    this.db.check(error);
    const ids = [...new Set((data || []).map(c => c.author_id))];
    if (!ids.length) return [];
    const { data: profiles } = await this.db.client.from('profiles').select('id,display_name').in('id', ids);
    const names = new Map((profiles || []).map(p => [p.id, p.display_name]));
    return (data || []).map(c => ({ ...c, authorName: names.get(c.author_id) || 'Member' }));
  }
  @Post(':postId')
  async add(@Req() req: AuthRequest, @Param('postId', ParseUUIDPipe) postId: string, @Body() body: AddCommentDto) {
    if (!body.body.trim()) throw new BadRequestException('Comment cannot be empty');
    const { data: post, error: postError } = await this.db.client.from('posts').select('status,expires_at').eq('id', postId).maybeSingle();
    this.db.check(postError);
    if (!post || post.status !== 'PUBLISHED' || new Date(post.expires_at).getTime() <= Date.now()) throw new BadRequestException('Activity unavailable');
    const { data, error } = await this.db.client.from('comments').insert({ post_id: postId, author_id: req.userId, body: body.body.trim() }).select('*').single();
    this.db.check(error);
    return data;
  }
}
