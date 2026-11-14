import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('interests')
export class InterestsController {
  constructor(private readonly db: SupabaseService) {}
  @Post(':postId')
  async join(@Req() req: AuthRequest, @Param('postId', ParseUUIDPipe) postId: string) {
    const { data, error } = await this.db.client.rpc('express_interest', { p_actor: req.userId, p_post: postId });
    if (error) throw new BadRequestException(error.message);
    return data;
  }
  @Get('mine/list')
  async mine(@Req() req: AuthRequest) {
    const { data, error } = await this.db.client.from('interests').select('post_id,created_at').eq('user_id', req.userId).order('created_at', { ascending: false });
    this.db.check(error);
    return data;
  }
}
