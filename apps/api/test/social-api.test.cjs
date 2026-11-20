// Build the API first, then run with node --test apps/api/test/social-api.test.cjs.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { InternalServerErrorException, ValidationPipe } = require('@nestjs/common');
const { PostsService } = require('../dist/posts/posts.service');
const { InterestsController } = require('../dist/interests/interests.controller');
const { NotificationsController } = require('../dist/notifications/notifications.controller');
const { CommentsController } = require('../dist/comments/comments.controller');
const { AuthGuard } = require('../dist/auth/auth.guard');
const { AddCommentDto } = require('../dist/common/dtos');

// Records backend queries without reading credentials or connecting to Supabase.
function database(responses) {
  const queue = [...responses];
  const calls = [];
  function query(table) {
    const steps = [];
    const result = {};
    for (const method of ['select', 'eq', 'in', 'order', 'limit', 'range', 'maybeSingle', 'single', 'insert', 'update', 'upsert']) {
      result[method] = (...args) => { steps.push([method, ...args]); return result; };
    }
    result.then = (resolve, reject) => Promise.resolve().then(() => {
      calls.push({ table, steps });
      assert.ok(queue.length, `Unexpected query: ${table}`);
      return { error: null, ...queue.shift() };
    }).then(resolve, reject);
    return result;
  }
  return { calls, queue, client: {
    from: query,
    rpc(name, args) { calls.push({ rpc: name, args }); return query('rpc'); },
  }, check(error) { if (error) throw new InternalServerErrorException('Database or storage request failed'); } };
}
const post = { id: 'post-1', creator_id: 'owner', status: 'PUBLISHED', expires_at: new Date(Date.now() + 3600000).toISOString() };
const query = { latitude: 41, longitude: -80, radius: 10, offset: 0, limit: 20, time: 'now' };

test('feed batches exact counts and viewer state into one summary request', async () => {
  const rows = [post, { ...post, id: 'post-2' }, { ...post, id: 'post-3' }];
  const db = database([{ data: rows }, { data: [{ id: 'owner', display_name: 'Creator' }] }, { data: [] }, { data: [
    { post_id: 'post-1', interest_count: '1200', interested: false },
    { post_id: 'post-2', interest_count: 1, interested: true },
    { post_id: 'post-3', interest_count: 0, interested: false },
  ] }]);
  const result = await new PostsService(db).nearby('viewer', query);
  assert.deepEqual(result.map(row => row.interestCount), [1200, 1, 0]);
  assert.deepEqual(result.map(row => row.interested), [false, true, false]);
  assert.equal(result[0].creatorName, 'Creator');
  const summaryCalls = db.calls.filter(call => call.rpc === 'post_interest_summary');
  assert.equal(summaryCalls.length, 1);
  assert.deepEqual(summaryCalls[0].args, { p_posts: ['post-1', 'post-2', 'post-3'], p_viewer: 'viewer' });
  assert.equal(db.calls.some(call => call.table === 'interests'), false);
  assert.equal(result.some(row => 'user_id' in row || 'interestedUsers' in row), false);
  assert.equal(db.queue.length, 0);
});

test('details and own posts use the same count and viewer-state enrichment as the feed', async () => {
  for (const method of ['post', 'myPosts']) {
    const db = database([{ data: method === 'post' ? post : [post] }, { data: [] }, { data: [] }, { data: [{ post_id: post.id, interest_count: 12, interested: true }] }]);
    const service = new PostsService(db);
    const response = await service[method]('owner', post.id);
    const result = Array.isArray(response) ? response[0] : response;
    assert.equal(result.interestCount, 12);
    assert.equal(result.interested, true);
    assert.equal(result.isOwn, true);
  }
});

test('empty pages need no summary query and summary failures are not presented as zero interest', async () => {
  const empty = database([{ data: [] }]);
  assert.deepEqual(await new PostsService(empty).nearby('viewer', query), []);
  assert.equal(empty.calls.filter(call => call.rpc === 'post_interest_summary').length, 0);
  const failed = database([{ data: [post] }, { data: [] }, { data: [] }, { error: { message: 'database unavailable' } }]);
  await assert.rejects(new PostsService(failed).nearby('viewer', query), /Database or storage/);
});

test('interest endpoint preserves the RPC response and uses the authenticated actor', async () => {
  const result = { id: 'interest-1', created: false };
  const db = database([{ data: result }]);
  assert.deepEqual(await new InterestsController(db).join({ userId: 'viewer', body: { userId: 'imposter' } }, post.id), result);
  assert.deepEqual(db.calls[0], { rpc: 'express_interest', args: { p_actor: 'viewer', p_post: post.id } });
});

test('self-interest and unavailable-activity database errors stay rejected at the API boundary', async () => {
  for (const message of ['Cannot join your own activity', 'Activity unavailable']) {
    const db = database([{ error: { message, code: 'P0001' } }]);
    await assert.rejects(new InterestsController(db).join({ userId: 'viewer' }, post.id), error => error.getStatus() === 400 && error.message === message);
  }
});

test('notifications are read and listed only for the authenticated recipient', async () => {
  const notification = { id: 'notice-1', post_id: post.id, message: 'Alex wants to join Coffee', is_read: false };
  const db = database([{ data: [notification] }, { data: { id: notification.id, is_read: true } }]);
  const controller = new NotificationsController(db);
  assert.deepEqual(await controller.inbox({ userId: 'owner' }), [notification]);
  assert.equal((await controller.read({ userId: 'owner' }, notification.id)).is_read, true);
  for (const call of db.calls) assert.ok(call.steps.some(step => step[0] === 'eq' && step[1] === 'recipient_id' && step[2] === 'owner'));
});

test('another user cannot mark a private notification read', async () => {
  const db = database([{ data: null }]);
  assert.deepEqual(await new NotificationsController(db).read({ userId: 'other' }, 'notice-1'), { id: 'notice-1', is_read: false });
  assert.ok(db.calls[0].steps.some(step => step[0] === 'eq' && step[1] === 'recipient_id' && step[2] === 'other'));
});

test('comments keep the authenticated author and requested activity association', async () => {
  const saved = { id: 'comment-1', author_id: 'viewer', post_id: post.id, body: 'Hello' };
  const db = database([{ data: post }, { data: saved }]);
  assert.deepEqual(await new CommentsController(db).add({ userId: 'viewer' }, post.id, { body: ' Hello ' }), saved);
  assert.deepEqual(db.calls[1].steps.find(step => step[0] === 'insert')[1], { post_id: post.id, author_id: 'viewer', body: 'Hello' });
  const validation = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  await assert.rejects(validation.transform({ body: 'Hello', author_id: 'imposter' }, { type: 'body', metatype: AddCommentDto }), error => error.getStatus() === 400);
});

test('successful token verification replaces any supplied user identity', async () => {
  const request = { headers: { authorization: 'Bearer valid-token' }, userId: 'imposter' };
  const guard = new AuthGuard({ client: { auth: { getUser: async token => {
    assert.equal(token, 'valid-token');
    return { data: { user: { id: 'viewer', email: 'member@example.com', user_metadata: { display_name: 'Alex' } } }, error: null };
  } } } });
  assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), true);
  assert.equal(request.userId, 'viewer');
});
