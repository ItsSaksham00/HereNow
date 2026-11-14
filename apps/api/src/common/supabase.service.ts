import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  readonly client: SupabaseClient;

  // Creates the shared Supabase client for server-side requests.
  constructor() {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !secret) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/api/.env');
    this.client = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  }

  // Reports database failures without exposing their details to the client.
  check(error: { message: string } | null): void {
    if (error) {
      console.error('Supabase operation failed:', error.message);
      throw new InternalServerErrorException('Database or storage request failed');
    }
  }
}
