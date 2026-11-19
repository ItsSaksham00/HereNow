// Build the API first; all data and storage calls here are local substitutes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ValidationPipe } = require('@nestjs/common');
const { UsersController } = require('../dist/users/users.controller');
const { PostsController } = require('../dist/posts/posts.controller');
const { PostsService } = require('../dist/posts/posts.service');
const { EditProfileDto, EditPostDto, MyPostsQuery } = require('../dist/common/dtos');

// Captures the exact queries and rejects unplanned database or storage access.
function database(responses = [], storageError = null) {
  const calls = [], queue = [...responses];
  const client = { from(table) {
    const steps = [], builder = {};
    for (const method of ['select', 'eq', 'is', 'gt', 'lte', 'or', 'order', 'range', 'maybeSingle', 'single', 'upsert', 'update', 'delete']) {
      builder[method] = (...args) => { steps.push([method, ...args]); return builder; };
    }
    builder.then = (resolve, reject) => Promise.resolve().then(() => {
      calls.push({ table, steps }); assert.ok(queue.length, `Unexpected query ${table}`);
      return { error: null, ...queue.shift() };
    }).then(resolve, reject);
    return builder;
  }, storage: { from(bucket) { return { async list(prefix) { calls.push({ list: prefix }); return { data: [], error: null }; }, async remove(keys) { calls.push({ bucket, keys }); return { error: storageError }; } }; } } };
  return { client, calls, queue, check(error) { if (error) throw new Error('Database or storage request failed'); } };
}
const actor = { userId: 'owner', email: 'owner@example.test', displayName: 'Original auth name' };
const account = { id: 'owner', display_name: 'Saved name', bio: 'Hello', push_enabled: true };
const now = Date.now();
const activity = { id: 'post-1', creator_id: 'owner', status: 'PUBLISHED', title: 'Coffee', description: 'Join us', category: 'Food',
  place_name: 'Cafe', latitude: 41, longitude: -80, activity_at: new Date(now - 60000).toISOString(),
  published_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 3600000).toISOString() };
const details = { title: ' Changed ', description: ' New description ', category: 'Social', placeName: ' New cafe ', latitude: 42, longitude: -81, activityAt: activity.activity_at };
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const validate = (type, body, kind = 'body') => pipe.transform(body, { type: kind, metatype: type });

// Avoids unrelated enrichment while testing the fields that an update writes.
function service(db) {
  const posts = new PostsService(db);
  posts.post = async (_user, id) => ({ id });
  return posts;
}

test('profile reads use the verified identity, authenticated email, and exact count rather than the current page size', async () => {
  const db = database([{ data: account }, { count: 105 }]);
  const result = await new UsersController(db).me({ ...actor, body: { userId: 'other' } });
  assert.equal(result.email, actor.email); assert.equal(result.postCount, 105); assert.equal(result.bio, 'Hello');
  for (const call of db.calls) assert.ok(call.steps.some(step => step[0] === 'eq' && step[2] === 'owner'));
  assert.deepEqual(db.calls[1].steps[0], ['select', 'id', { count: 'exact', head: true }]);
});

test('profile edits persist only the actor fields and remain visible on another profile read', async () => {
  const saved = { ...account, display_name: 'Alex', bio: 'Student' };
  const db = database([{}, { data: saved }, { count: 2 }, { data: saved }, { count: 2 }]);
  const controller = new UsersController(db);
  const result = await controller.update(actor, await validate(EditProfileDto, { displayName: ' Alex ', bio: ' Student ' }));
  assert.equal(result.display_name, 'Alex');
  assert.deepEqual(db.calls[0].steps.find(step => step[0] === 'upsert')[1], { id: 'owner', display_name: 'Alex', bio: 'Student' });
  assert.equal((await controller.me(actor)).bio, 'Student');
});

test('sign-in synchronization never overwrites an existing profile or a concurrent edit', async () => {
  let db = database([{ data: account }, { data: account }, { count: 0 }]);
  await new UsersController(db).createProfile(actor);
  assert.equal(db.calls.some(call => call.steps.some(step => step[0] === 'upsert')), false);
  db = database([{ data: null }, {}, { data: account }, { count: 0 }]);
  await new UsersController(db).createProfile(actor);
  assert.deepEqual(db.calls[1].steps.find(step => step[0] === 'upsert')[2], { onConflict: 'id', ignoreDuplicates: true });
});

test('notification-only updates preserve bio, and profile validation rejects blank names or forged identity', async () => {
  const db = database([{}, { data: account }, { count: 1 }]);
  await new UsersController(db).update(actor, { displayName: account.display_name, pushEnabled: false });
  const saved = db.calls[0].steps.find(step => step[0] === 'upsert')[1];
  assert.equal('bio' in saved, false); assert.equal(saved.push_enabled, false);
  for (const body of [{ displayName: ' ' }, { displayName: 'a'.repeat(61) }, { displayName: 'Alex', bio: 'a'.repeat(301) }, { displayName: 'Alex', bio: null }, { displayName: 'Alex', id: 'other' }, { displayName: 'Alex', email: 'other@test' }]) await assert.rejects(validate(EditProfileDto, body));
});

test('My Posts applies owner-only filters before pagination, including elapsed PUBLISHED deadlines', async () => {
  for (const filter of ['active', 'upcoming', 'expired', 'all']) {
    const db = database([{ data: [] }]);
    const posts = new PostsService(db); posts.enrich = async rows => rows;
    assert.deepEqual(await posts.myPosts('owner', { filter, offset: 20, limit: 20 }), []);
    const steps = db.calls[0].steps;
    assert.ok(steps.some(step => step[0] === 'eq' && step[1] === 'creator_id' && step[2] === 'owner'));
    assert.deepEqual(steps.at(-1), ['range', 20, 39]);
    if (filter === 'active' || filter === 'upcoming') {
      assert.ok(steps.some(step => step[0] === 'eq' && step[1] === 'status' && step[2] === 'PUBLISHED'));
      assert.ok(steps.some(step => step[0] === 'gt' && step[1] === 'expires_at'));
      assert.ok(steps.some(step => step[0] === (filter === 'active' ? 'lte' : 'gt') && step[1] === 'activity_at'));
    }
    if (filter === 'expired') assert.match(steps.find(step => step[0] === 'or')[1], /^status.eq.EXPIRED,expires_at.lte\./);
  }
});

test('My Posts query validation prevents unbounded pages and actor overrides', async () => {
  for (const query of [{ limit: 41 }, { offset: -1 }, { offset: 0.5 }, { filter: 'private' }, { userId: 'other' }]) await assert.rejects(validate(MyPostsQuery, query, 'query'));
  const query = await validate(MyPostsQuery, { limit: '20', offset: '40', filter: 'upcoming' }, 'query');
  assert.equal(query.offset, 40); assert.equal(query.limit, 20);
});

test('post updates reject other users, missing posts, and ongoing photo analysis before writes', async () => {
  for (const [row, status] of [[activity, 403], [null, 404], [{ ...activity, creator_id: 'visitor', status: 'ANALYZING' }, 409]]) {
    const db = database([{ data: row }]);
    await assert.rejects(service(db).update('visitor', activity.id, details), error => error.getStatus() === status);
    assert.equal(db.calls.length, 1);
  }
});

test('ordinary edits preserve deadline, publication, photo, labels, comments, and interests', async () => {
  const expired = { ...activity, expires_at: new Date(now - 1).toISOString() };
  for (const row of [activity, expired]) {
    const db = database([{ data: row }, { data: { id: row.id } }]);
    await service(db).update('owner', row.id, details);
    const steps = db.calls[1].steps;
    const changes = steps.find(step => step[0] === 'update')[1];
    assert.deepEqual(Object.keys(changes).sort(), ['title', 'description', 'category', 'place_name', 'latitude', 'longitude', 'activity_at'].sort());
    assert.ok(steps.some(step => step[0] === 'eq' && step[1] === 'activity_at' && step[2] === row.activity_at));
    assert.equal(changes.title, 'Changed'); assert.equal(changes.place_name, 'New cafe');
    assert.ok(steps.some(step => step[0] === 'eq' && step[1] === 'creator_id' && step[2] === 'owner'));
    assert.equal(db.calls.every(call => call.table === 'posts'), true);
  }
});

test('rescheduling future and current activities uses the configured lifetime without rewriting publication time', async () => {
  const previous = process.env.POST_LIFETIME_HOURS;
  process.env.POST_LIFETIME_HOURS = '4';
  try {
    for (const start of [new Date(Date.now() + 86400000).toISOString(), new Date(Date.now() - 1000).toISOString()]) {
      const db = database([{ data: activity }, { data: { id: activity.id } }]);
      await service(db).update('owner', activity.id, { ...details, activityAt: start });
      const changes = db.calls[1].steps.find(step => step[0] === 'update')[1];
      const expected = Math.max(new Date(start).getTime(), Date.now()) + 4 * 3600000;
      assert.ok(Math.abs(new Date(changes.expires_at).getTime() - expected) < 1000);
      assert.equal('published_at' in changes, false);
    }
    const db = database([{ data: activity }]);
    await assert.rejects(service(db).update('owner', activity.id, { ...details, activityAt: new Date(Date.now() - 86400000).toISOString() }), /already be expired/);
    assert.equal(db.calls.length, 1);
  } finally {
    if (previous === undefined) delete process.env.POST_LIFETIME_HOURS; else process.env.POST_LIFETIME_HOURS = previous;
  }
});

test('edit DTO rejects protected fields and invalid details, and controller supplies the verified actor', async () => {
  for (const extra of [{ creator_id: 'other' }, { status: 'PUBLISHED' }, { expires_at: '2099-01-01' }, { labels: [] }, { requestId: 'forged' }, { title: ' ' }, { latitude: 100 }, { category: 'Unknown' }, { activityAt: '2026-01-01T12:00:00' }]) await assert.rejects(validate(EditPostDto, { ...details, ...extra }));
  let received;
  const controller = new PostsController({ update: (...args) => { received = args; } });
  controller.update(actor, activity.id, details);
  assert.deepEqual(received, ['owner', activity.id, details]);
});

test('a deletion or concurrent reschedule returns a conflict instead of claiming the update succeeded', async () => {
  const db = database([{ data: activity }, { data: null }]);
  await assert.rejects(service(db).update('owner', activity.id, details), error => error.getStatus() === 409);
});

test('delete checks ownership and media lookup before deleting, and removes only the saved photo key', async () => {
  const denied = database([{ data: { creator_id: 'owner' } }]);
  await assert.rejects(service(denied).delete('other', activity.id), error => error.getStatus() === 403);
  assert.equal(denied.calls.length, 1);
  const missing = database([{ data: null }]);
  assert.deepEqual(await service(missing).delete('owner', activity.id), { deleted: true });
  assert.equal(missing.calls.at(-1).list, 'owner/post-1');
  const db = database([{ data: { creator_id: 'owner' } }, { data: { object_key: 'owner/post-1/photo.jpg' } }, {}]);
  assert.deepEqual(await service(db).delete('owner', activity.id), { deleted: true });
  assert.deepEqual(db.calls.at(-1), { bucket: 'post-images', keys: ['owner/post-1/photo.jpg'] });
  assert.ok(db.calls[2].steps.some(step => step[0] === 'eq' && step[1] === 'creator_id' && step[2] === 'owner'));
  for (const responses of [[{ data: activity }, { error: {} }], [{ data: activity }, { data: null }, { error: {} }]]) {
    const failed = database(responses);
    await assert.rejects(service(failed).delete('owner', activity.id), /Database or storage/);
    assert.equal(failed.calls.some(call => call.bucket), false);
  }
});

test('failed post-delete storage cleanup is retryable and cannot touch another owner folder', async () => {
  const first = database([{ data: activity }, { data: { object_key: 'owner/post-1/photo.jpg' } }, {}], { message: 'offline' });
  await assert.rejects(service(first).delete('owner', activity.id), error => error.getStatus() === 503 && /Retry deleting/.test(error.message));
  assert.equal(first.calls[2].steps[0][0], 'delete');
  const retry = database([{ data: null }]);
  let reads = 0;
  retry.client.storage.from = bucket => ({
    async list(prefix, options) {
      assert.equal(bucket, 'post-images'); assert.equal(prefix, 'owner/post-1'); assert.equal(options.limit, 100);
      return { error: null, data: reads++ === 0 ? [{ id: 'file-1', name: 'photo.jpg' }] : [] };
    },
    async remove(keys) { assert.deepEqual(keys, ['owner/post-1/photo.jpg']); return { error: null }; },
  });
  assert.deepEqual(await service(retry).delete('owner', activity.id), { deleted: true });
  assert.equal(reads, 2);
});

test('editing an unpublished draft keeps it unpublished, while explicit expired rescheduling updates its deadline', async () => {
  const start = new Date(Date.now() + 86400000).toISOString();
  for (const [status, publishedAt] of [['READY', null], ['EXPIRED', activity.published_at]]) {
    const db = database([{ data: { ...activity, status, published_at: publishedAt } }, { data: { id: activity.id } }]);
    await service(db).update('owner', activity.id, { ...details, activityAt: start });
    const changes = db.calls[1].steps.find(step => step[0] === 'update')[1];
    if (status === 'READY') { assert.equal('status' in changes, false); assert.equal('expires_at' in changes, false); }
    else { assert.equal(changes.status, 'PUBLISHED'); assert.ok(new Date(changes.expires_at) > new Date(start)); }
  }
});
