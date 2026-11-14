import { Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly db: SupabaseService) {}
  @Get()
  async inbox(@Req() req: AuthRequest) {
    const { data, error } = await this.db.client.from('notifications').select('*').eq('recipient_id', req.userId).order('created_at', { ascending: false }).limit(50);
    this.db.check(error);
    return data;
  }
  @Patch(':id/read')
  async read(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    const { data, error } = await this.db.client.from('notifications').update({ is_read: true }).eq('id', id).eq('recipient_id', req.userId).select('id,is_read').maybeSingle();
    this.db.check(error);
    return data || { id, is_read: false };
  }
}
