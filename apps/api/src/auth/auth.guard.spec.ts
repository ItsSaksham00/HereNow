import { beforeEach, describe, expect, jest, test } from '@jest/globals';

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

  // Checks that a verified session attaches the user to the request.
  test('U1-01 allows access with a valid authentication token', async () => {
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
    expect(mockDb.client.auth.getUser).toHaveBeenCalledWith('valid-token');
    expect(mockRequest.userId).toBe('user-123');
    expect(mockRequest.email).toBe('test@example.com');
    expect(mockRequest.displayName).toBe('Test User');
    console.log(JSON.stringify({ id: 'U1-01', actual, expected: true }));
  });

  // Checks that a missing token is rejected before calling Auth.
  test('U1-02 rejects a request without an authorization token', async () => {
    mockRequest.headers = {};

    const error = await authGuard.canActivate(mockContext).catch(error => error);
    expect(error.message).toBe('Sign in required');
    expect(error.getStatus()).toBe(401);
    console.log(JSON.stringify({ id: 'U1-02', actual: error.message, expected: 'Sign in required' }));

    expect(
      mockDb.client.auth.getUser
    ).not.toHaveBeenCalled();
  });

  // Checks that an invalid session is rejected.
  test('U1-03 rejects an invalid or expired session', async () => {
    mockDb.client.auth.getUser.mockResolvedValue({
      data: {
        user: null,
      },
      error: {
        message: 'Invalid token',
      },
    });

    const error = await authGuard.canActivate(mockContext).catch(error => error);
    expect(error.message).toBe('Invalid or expired session');
    expect(error.getStatus()).toBe(401);
    console.log(JSON.stringify({ id: 'U1-03', actual: error.message, expected: 'Invalid or expired session' }));

    expect(
      mockDb.client.auth.getUser
    ).toHaveBeenCalledWith('valid-token');
  });

});
