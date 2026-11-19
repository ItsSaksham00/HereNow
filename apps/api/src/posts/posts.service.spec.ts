
import { PostsService } from './posts.service';
import { SupabaseService } from '../common/supabase.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('PostsService Unit Tests', () => {
  let postsService: PostsService;
  let mockDb: any;
  let mockQuery: any;

  beforeEach(() => {
    mockQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn(),
      single: jest.fn(),
    };

    mockQuery.select.mockReturnValue(mockQuery);
    mockQuery.eq.mockReturnValue(mockQuery);

    mockDb = {
      client: {
        from: jest.fn().mockReturnValue(mockQuery),
      },
      check: jest.fn((error) => {
        if (error) throw new Error(error.message);
      }),
    };

    postsService = new PostsService(
      mockDb as SupabaseService,
    );
  });

  // TEST 1: Rejects a post that does not exist.
  test('rejects a request for a nonexistent post', async () => {
    mockQuery.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    await expect(
      postsService.post('user-123', 'post-456')
    ).rejects.toThrow(NotFoundException);

    expect(mockDb.client.from).toHaveBeenCalledWith('posts');
  });

  // TEST 2: Hides unpublished posts from other users.
  test('does not allow another user to view an unpublished post', async () => {
    mockQuery.maybeSingle.mockResolvedValue({
      data: {
        id: 'post-456',
        creator_id: 'user-999',
        status: 'READY',
        expires_at: '2099-01-01T00:00:00.000Z',
      },
      error: null,
    });

    await expect(
      postsService.post('user-123', 'post-456')
    ).rejects.toThrow(NotFoundException);
  });

  // TEST 3: Rejects publication when the post is not ready.
  test('rejects publication of a post that is not ready', async () => {
    mockQuery.single.mockResolvedValue({
      data: {
        id: 'post-456',
        creator_id: 'user-123',
        status: 'PROCESSING',
        title: 'Test Activity',
        description: 'Test description',
        place_name: 'Test Location',
        category: 'Social',
      },
      error: null,
    });

    await expect(
      postsService.publish('user-123', 'post-456')
    ).rejects.toThrow(BadRequestException);

    expect(mockDb.client.from).toHaveBeenCalledWith('posts');
  });
});
