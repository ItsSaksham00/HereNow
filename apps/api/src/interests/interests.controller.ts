import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('interests')
export class InterestsController {
  constructor(private readonly db: SupabaseService) {}

  // Records interest using the database’s activity rules.
  @Post(':postId')
  async join(@Req() request: AuthRequest, @Param('postId', ParseUUIDPipe) postId: string) {
    const { data, error } = await this.db.client.rpc('express_interest', { p_actor: request.userId, p_post: postId });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Lists the signed-in user’s activity interests.
  @Get('mine/list')
  async mine(@Req() request: AuthRequest) {
    const { data, error } = await this.db.client
      .from('interests')
      .select('post_id,created_at')
      .eq('user_id', request.userId)
      .order('created_at', { ascending: false });
    this.db.check(error);
    return data;
  }
}
