
import { AuthGuard } from './auth.guard';
import { SupabaseService } from '../common/supabase.service';
import { ExecutionContext } from '@nestjs/common';

describe('AuthGuard Unit Tests', () => {
  let authGuard: AuthGuard;
  let mockDb: any;
  let mockRequest: any;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    mockDb = {
      client: {
        auth: {
          getUser: jest.fn(),
        },
      },
    };

    mockRequest = {
      headers: {
        authorization: 'Bearer valid-token',
      },
    } as any;

    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    authGuard = new AuthGuard(
      mockDb as SupabaseService
    );
  });

  // TEST 1: Valid authentication
  test('allows access with a valid authentication token', async () => {
    mockDb.client.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-123',
          email: 'test@example.com',
          user_metadata: {
            display_name: 'Test User',
          },
        },
      },
      error: null,
    });

    const actual = await authGuard.canActivate(mockContext);

    expect(actual).toBe(true);
    expect(mockRequest.userId).toBe('user-123');
    expect(mockRequest.email).toBe('test@example.com');
    expect(mockRequest.displayName).toBe('Test User');
  });

  // TEST 2: Missing authentication token
  test('rejects a request without an authorization token', async () => {
    mockRequest.headers = {};

    await expect(
      authGuard.canActivate(mockContext)
    ).rejects.toThrow('Sign in required');

    expect(
      mockDb.client.auth.getUser
    ).not.toHaveBeenCalled();
  });

  // TEST 3: Invalid or expired authentication token
  test('rejects an invalid or expired session', async () => {
    mockDb.client.auth.getUser.mockResolvedValue({
      data: {
        user: null,
      },
      error: {
        message: 'Invalid token',
      },
    });

    await expect(
      authGuard.canActivate(mockContext)
    ).rejects.toThrow('Invalid or expired session');

    expect(
      mockDb.client.auth.getUser
    ).toHaveBeenCalledWith('valid-token');
  });

});
