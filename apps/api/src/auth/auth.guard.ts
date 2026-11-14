import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import type { Request } from 'express';

export type AuthRequest = Request & { userId: string; email: string; displayName: string };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly db: SupabaseService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Sign in required');
    // getUser verifies token validity with Supabase Auth, not just decoding it.
    const { data, error } = await this.db.client.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Invalid or expired session');
    req.userId = data.user.id;
    req.email = data.user.email || '';
    req.displayName = typeof data.user.user_metadata?.display_name === 'string' ? data.user.user_metadata.display_name : '';
    return true;
  }
}
