import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { EditProfileDto } from '../common/dtos';
import type { AuthRequest } from '../auth/auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly db: SupabaseService) {}

  // Creates a profile if the signed-in user does not have one yet.
  @Post('me')
  async createProfile(@Req() request: AuthRequest) {
    const { data: existingProfile, error: readError } = await this.db.client.from('profiles').select('*').eq('id', request.userId).maybeSingle();
    this.db.check(readError);
    if (existingProfile) return existingProfile;
    const displayName = ( request.displayName.trim().slice(0, 60) || request.email.split('@')[0] || 'HereNow member').slice(0, 60);
    const { data, error } = await this.db.client
      .from('profiles')
      .upsert({ id: request.userId, display_name: displayName }, { onConflict: 'id' })
      .select()
      .single();
    this.db.check(error);
    return data;
  }

  // Returns the current profile or its default values.
  @Get('me')
  async me(@Req() request: AuthRequest) {
    const { data, error } = await this.db.client.from('profiles').select('*').eq('id', request.userId).maybeSingle();
    this.db.check(error);
    return data || { id: request.userId, display_name: request.email.split('@')[0], push_enabled: false };
  }

  // Saves the current user’s profile and optional notification preference.
  @Patch('me')
  async update(@Req() request: AuthRequest, @Body() body: EditProfileDto) {
    const { data, error } = await this.db.client
      .from('profiles')
      .upsert({
        id: request.userId,
        display_name: body.displayName,
        ...(body.pushEnabled === undefined ? {} : { push_enabled: body.pushEnabled })
      }, { onConflict: 'id' })
      .select()
      .single();
    this.db.check(error);
    return data;
  }
}
