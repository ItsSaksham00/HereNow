
import { UsersController } from './users.controller';
import { SupabaseService } from '../common/supabase.service';
import { AuthRequest } from '../auth/auth.guard';

describe('UsersController Unit Tests', () => {
  let usersController: UsersController;
  let mockDb: any;
  let mockRequest: any;
  let mockQuery: any;

  beforeEach(() => {
    mockQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn(),
      upsert: jest.fn(),
      single: jest.fn(),
    };

    // Make Supabase query methods chainable.
    mockQuery.select.mockReturnValue(mockQuery);
    mockQuery.eq.mockReturnValue(mockQuery);
    mockQuery.upsert.mockReturnValue(mockQuery);

    mockDb = {
      client: {
        from: jest.fn().mockReturnValue(mockQuery),
      },
      check: jest.fn((error) => {
        if (error) throw new Error(error.message);
      }),
    };

    mockRequest = {
      userId: 'user-123',
      email: 'test@example.com',
      displayName: 'Test User',
    };

    usersController = new UsersController(
      mockDb as SupabaseService,
    );
  });

  // TEST 1: Creates a profile when one does not exist.
  test('creates a profile for a user without an existing profile', async () => {
    mockQuery.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    mockQuery.single.mockResolvedValue({
      data: {
        id: 'user-123',
        display_name: 'Test User',
      },
      error: null,
    });

    const actual = await usersController.createProfile(
      mockRequest as AuthRequest,
    );

    expect(actual).toEqual({
      id: 'user-123',
      display_name: 'Test User',
    });

    expect(mockDb.client.from).toHaveBeenCalledWith('profiles');
    expect(mockQuery.upsert).toHaveBeenCalledWith(
      {
        id: 'user-123',
        display_name: 'Test User',
      },
      { onConflict: 'id' },
    );
  });

  // TEST 2: Returns default profile values when no profile exists.
  test('returns default profile values when a profile does not exist', async () => {
    mockQuery.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const actual = await usersController.me(
      mockRequest as AuthRequest,
    );

    expect(actual).toEqual({
      id: 'user-123',
      display_name: 'test',
      push_enabled: false,
    });
  });

  // TEST 3: Fallback display name should not exceed 60 characters.
  test('limits the fallback display name to 60 characters', async () => {
    const longEmail = `${'a'.repeat(70)}@example.com`;

    mockRequest.displayName = '';

    mockQuery.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    mockQuery.single.mockResolvedValue({
      data: {
        id: 'user-123',
        display_name: 'a'.repeat(70),
      },
      error: null,
    });

    const actual = await usersController.createProfile({
      ...mockRequest,
      email: longEmail,
    } as any);

    expect(actual.display_name.length).toBeLessThanOrEqual(60);
  });
});
