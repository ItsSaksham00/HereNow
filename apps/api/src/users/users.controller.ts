import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { EditProfileDto } from '../common/dtos';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly db: SupabaseService) {}
  @Post('me')
  async createProfile(@Req() req: AuthRequest) {
    const { data: found, error: readError } = await this.db.client.from('profiles').select('*').eq('id', req.userId).maybeSingle();
    this.db.check(readError);
    if (found) return found;
    const name = req.displayName.trim().slice(0,60) || req.email.split('@')[0] || 'HereNow member';
    const { data, error } = await this.db.client.from('profiles').upsert({ id: req.userId, display_name: name }, { onConflict: 'id' }).select().single();
    this.db.check(error);
    return data;
  }
  @Get('me')
  async me(@Req() req: AuthRequest) {
    const { data, error } = await this.db.client.from('profiles').select('*').eq('id', req.userId).maybeSingle();
    this.db.check(error);
    return data || { id: req.userId, display_name: req.email.split('@')[0], push_enabled: false };
  }
  @Patch('me')
  async update(@Req() req: AuthRequest, @Body() body: EditProfileDto) {
    const { data, error } = await this.db.client.from('profiles').upsert({ id: req.userId, display_name: body.displayName, ...(body.pushEnabled === undefined ? {} : { push_enabled: body.pushEnabled }) }, { onConflict: 'id' }).select().single();
    this.db.check(error);
    return data;
  }
}
