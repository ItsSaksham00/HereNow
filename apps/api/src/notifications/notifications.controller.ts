import { Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly db: SupabaseService) {}

  // Lists the signed-in user’s latest notifications.
  @Get()
  async inbox(@Req() request: AuthRequest) {
    const { data, error } = await this.db.client
      .from('notifications')
      .select('*')
      .eq('recipient_id', request.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    this.db.check(error);
    return data;
  }

  // Marks a notification as read when it belongs to this user.
  @Patch(':id/read')
  async read(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    const { data, error } = await this.db.client
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('recipient_id', request.userId)
      .select('id,is_read')
      .maybeSingle();
    this.db.check(error);
    return data || { id, is_read: false };
  }
}
