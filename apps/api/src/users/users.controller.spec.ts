import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { UsersController } from './users.controller';
import { SupabaseService } from '../common/supabase.service';
import { AuthRequest } from '../auth/auth.guard';

describe('UsersController Unit Tests', () => {
  let usersController: UsersController;
  let mockQuery: any;
  let savedProfile: any;
  let postCount: number;
  const request = {
    userId: 'user-123', email: 'test@example.com', displayName: 'Test User',
  } as AuthRequest;

  beforeEach(() => {
    savedProfile = null;
    postCount = 0;
    mockQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn(async () => ({ data: savedProfile, error: null })),
      upsert: jest.fn(async (profile: any) => {
        savedProfile = { ...profile, push_enabled: false };
        return { error: null };
      }),
    };
    mockQuery.select.mockReturnValue(mockQuery);
    mockQuery.eq.mockReturnValue(mockQuery);
    const postsQuery = {
      select: jest.fn(),
      eq: jest.fn(async () => ({ count: postCount, error: null })),
    };
    postsQuery.select.mockReturnValue(postsQuery);
    const mockDb = {
      client: {
        from: jest.fn((table: string) => {
          if (table === 'profiles') return mockQuery;
          if (table === 'posts') return postsQuery;
          throw new Error(`Unexpected table: ${table}`);
        }),
      },
      check: jest.fn((error: any) => {
        if (error) throw new Error(error.message);
      }),
    };
    usersController = new UsersController(mockDb as unknown as SupabaseService);
  });

  // Checks that creation saves the profile and returns its current values and post count.
  test('creates a profile for a user without an existing profile', async () => {
    postCount = 2;
    const actual = await usersController.createProfile(request);
    expect(mockQuery.upsert).toHaveBeenCalledWith(
      { id: 'user-123', display_name: 'Test User' },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    expect(mockQuery.maybeSingle).toHaveBeenCalledTimes(2);
    expect(actual).toEqual({
      id: 'user-123', display_name: 'Test User', push_enabled: false,
      email: 'test@example.com', postCount: 2,
    });
  });

  // Checks the complete default response without creating a profile.
  test('returns default profile values when a profile does not exist', async () => {
    const actual = await usersController.me(request);
    expect(actual).toEqual({
      id: 'user-123', display_name: 'test', push_enabled: false,
      email: 'test@example.com', postCount: 0,
    });
    expect(mockQuery.upsert).not.toHaveBeenCalled();
  });

  // Checks that both the default and saved email-based names respect the 60-character limit.
  test('limits the fallback display name to 60 characters', async () => {
    const longEmail = `${'a'.repeat(70)}@example.com`;
    const unnamed = { ...request, displayName: '', email: longEmail } as AuthRequest;
    const fallback = await usersController.me(unnamed);
    expect(fallback.display_name).toBe('a'.repeat(60));
    const actual = await usersController.createProfile(unnamed);
    expect(savedProfile.display_name).toBe('a'.repeat(60));
    expect(actual.display_name).toBe('a'.repeat(60));
    expect(actual.email).toBe(longEmail);
    expect(actual.postCount).toBe(0);
  });
});
