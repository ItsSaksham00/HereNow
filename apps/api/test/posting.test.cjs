// Run after building the API: node --test apps/api/test/posting.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { InternalServerErrorException } = require('@nestjs/common');
const { PostsService } = require('../dist/posts/posts.service');
const { CommentsController } = require('../dist/comments/comments.controller');
const { AuthGuard } = require('../dist/auth/auth.guard');
const { AddCommentDto, CreatePostDto, NearbyQuery } = require('../dist/common/dtos');

const startsAt = new Date(Date.now() + 86400000).toISOString();
const post = { id: 'post-1', creator_id: 'owner', title: 'Coffee', description: 'Meet at the cafe', category: 'Food', place_name: 'Cafe', activity_at: startsAt, status: 'READY' };
const details = { title: ' Coffee ', description: ' Meet at the cafe ', category: 'Food', placeName: ' Cafe ', latitude: 41, longitude: -80, activityAt: startsAt, labels: ['coffee'] };
const jpeg = { mimetype: 'image/jpeg', size: 4, buffer: Buffer.from([255, 216, 255, 0]) };
const comment = { id: 'comment-1', post_id: post.id, author_id: 'owner', body: 'See you there', created_at: new Date().toISOString() };
const published = { ...post, status: 'PUBLISHED', expires_at: new Date(Date.now() + 3600000).toISOString() };

// Records external calls and supplies explicit database responses without connecting to Supabase.
function database(responses = [], storageError = null) {
  const calls = [];
  const queue = [...responses];
  function query(table) {
    const steps = [];
    const builder = {};
    for (const method of ['select', 'eq', 'in', 'order', 'limit', 'range', 'insert', 'update', 'upsert', 'delete', 'single', 'maybeSingle']) {
      builder[method] = (...args) => { steps.push([method, ...args]); return builder; };
    }
    builder.then = (resolve, reject) => Promise.resolve().then(() => {
      calls.push({ table, steps });
      assert.ok(queue.length, `Unexpected database query: ${table}`);
      const response = queue.shift();
      return { error: null, ...response };
    }).then(resolve, reject);
    return builder;
  }
  const client = {
    from: query,
    rpc: (name, args) => { calls.push({ rpc: name, args }); return query('rpc'); },
    storage: { from: bucket => ({
      upload: async (...args) => { calls.push({ storage: 'upload', bucket, args }); return { error: Array.isArray(storageError) ? storageError.shift() : storageError }; },
      remove: async (...args) => { calls.push({ storage: 'remove', bucket, args }); return { error: null }; },
    }) },
  };
  return { client, calls, queue, check(error) { if (error) throw new InternalServerErrorException('Database or storage request failed'); } };
}

// Keeps tests focused on the posting operation instead of unrelated profile enrichment.
function postsService(db) {
  const service = new PostsService(db);
  service.enrich = async rows => rows;
  service.generateDetails = async () => { throw new Error('Manual posting must not call AI'); };
  return service;
}

test('manual publishing works without an AI key or analysis job', async () => {
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const db = database([{ data: post }, {}, { data: post }, { data: { id: 'media-1' } }, {}, { data: published }]);
    const result = await postsService(db).create('owner', details, jpeg);
    assert.equal(result.status, 'PUBLISHED');
    const inserted = db.calls[0].steps.find(step => step[0] === 'insert')[1];
    assert.equal(inserted.title, 'Coffee');
    assert.equal(inserted.description, 'Meet at the cafe');
    assert.equal(inserted.activity_at, startsAt);
    assert.deepEqual(inserted.labels, ['coffee']);
    assert.equal(db.calls.some(call => call.table === 'ai_analysis_jobs'), false);
    const uploadIndex = db.calls.findIndex(call => call.storage === 'upload');
    const publishIndex = db.calls.findIndex(call => call.steps?.some(step => step[0] === 'update' && step[1].status === 'PUBLISHED'));
    assert.ok(uploadIndex < publishIndex);
    assert.equal(db.queue.length, 0);
  } finally {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});

test('upload failure removes the unpublished row', async () => {
  const db = database([{ data: post }, {}], { message: 'upload failed' });
  await assert.rejects(postsService(db).create('owner', details, jpeg), /Image upload failed/);
  assert.equal(db.calls.at(-1).steps[0][0], 'delete');
});

test('media record failure removes the draft and stored image', async () => {
  const db = database([{ data: post }, { error: { message: 'insert failed' } }, {}]);
  await assert.rejects(postsService(db).create('owner', details, jpeg), /Database or storage/);
  assert.equal(db.calls.at(-1).storage, 'remove');
  assert.ok(db.calls.some(call => call.steps?.[0][0] === 'delete'));
});

for (const [name, file] of [
  ['missing photo', undefined],
  ['unsupported format', { ...jpeg, mimetype: 'image/gif' }],
  ['forged JPEG', { ...jpeg, buffer: Buffer.from('not an image') }],
  ['oversized photo', { ...jpeg, size: 6 * 1024 * 1024 + 1 }],
]) {
  test(`rejects ${name} before database writes or AI calls`, async () => {
    const db = database();
    await assert.rejects(postsService(db).create('owner', details, file));
    await assert.rejects(postsService(db).suggest(file));
    assert.equal(db.calls.length, 0);
  });
}

test('publication requires ownership and a stored photo', async () => {
  const other = postsService(database([{ data: post }]));
  await assert.rejects(other.publish('another-user', post.id), error => error.getStatus() === 403);
  await assert.rejects(postsService(database([{ data: post }, { data: null }])).publish('owner', post.id), /photo is required/);
});

test('publication validates required details before updating status', async () => {
  for (const field of ['title', 'description', 'place_name', 'category']) {
    const db = database([{ data: { ...post, [field]: '' } }]);
    await assert.rejects(postsService(db).publish('owner', post.id), /before publishing/);
    assert.equal(db.calls.length, 1);
  }
});

test('scheduled activities expire after their start rather than after upload', async () => {
  const db = database([{ data: post }, { data: { id: 'media-1' } }, {}, { data: published }]);
  await postsService(db).publish('owner', post.id);
  const update = db.calls.find(call => call.steps?.some(step => step[0] === 'update')).steps.find(step => step[0] === 'update')[1];
  assert.equal(update.activity_at, startsAt);
  assert.ok(new Date(update.expires_at) > new Date(startsAt));
});

for (const [name, startOffset, expiryOffset] of [
  ['an activity already happening now', -30 * 60000, 3 * 3600000],
  ['an activity starting at publication', 0, 3 * 3600000],
  ['an upcoming activity a week away', 7 * 86400000, 7 * 86400000 + 3 * 3600000],
]) {
  test(`publication gives the full configured lifetime to ${name}`, async t => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    const previousLifetime = process.env.POST_LIFETIME_HOURS;
    process.env.POST_LIFETIME_HOURS = '3';
    t.after(() => {
      if (previousLifetime === undefined) delete process.env.POST_LIFETIME_HOURS;
      else process.env.POST_LIFETIME_HOURS = previousLifetime;
    });

    const activityAt = new Date(now + startOffset).toISOString();
    const draft = { ...post, activity_at: activityAt };
    const db = database([{ data: draft }, { data: { id: 'media-1' } }, {}, { data: published }]);
    await postsService(db).publish('owner', post.id);

    const update = db.calls[2].steps.find(step => step[0] === 'update')[1];
    assert.equal(update.published_at, new Date(now).toISOString());
    assert.equal(update.activity_at, activityAt);
    assert.equal(update.expires_at, new Date(now + expiryOffset).toISOString());
    assert.equal(db.queue.length, 0);
  });
}

test('already-expired activity times remain invalid and are not republished', async t => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const previousLifetime = process.env.POST_LIFETIME_HOURS;
  process.env.POST_LIFETIME_HOURS = '3';
  t.after(() => {
    if (previousLifetime === undefined) delete process.env.POST_LIFETIME_HOURS;
    else process.env.POST_LIFETIME_HOURS = previousLifetime;
  });

  for (const age of [3 * 3600000, 3 * 3600000 + 1]) {
    const activityAt = new Date(now - age).toISOString();
    const createDb = database();
    await assert.rejects(postsService(createDb).create('owner', { ...details, activityAt }, jpeg), /already be expired/);
    assert.equal(createDb.calls.length, 0);

    const publishDb = database([{ data: { ...post, activity_at: activityAt } }, { data: { id: 'media-1' } }]);
    await assert.rejects(postsService(publishDb).publish('owner', post.id), /already be expired/);
    assert.equal(publishDb.calls.some(call => call.steps?.some(step => step[0] === 'update')), false);
  }
});

test('expiration hides immediate and scheduled posts at the deadline while preserving owner access', async t => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  for (const activityAt of [new Date(now - 3600000).toISOString(), new Date(now + 7 * 86400000).toISOString()]) {
    for (const remaining of [-1, 0, 1]) {
      const activity = { ...published, activity_at: activityAt, expires_at: new Date(now + remaining).toISOString() };
      const visitorService = postsService(database([{ data: activity }]));
      if (remaining <= 0) {
        await assert.rejects(visitorService.post('viewer', post.id), error => error.getStatus() === 404);
      } else {
        assert.equal((await visitorService.post('viewer', post.id)).id, post.id);
      }
      assert.equal((await postsService(database([{ data: activity }])).post('owner', post.id)).id, post.id);
    }
  }
});

test('expired activity times are rejected before uploading', async () => {
  const db = database();
  await assert.rejects(postsService(db).create('owner', { ...details, activityAt: '2000-01-01T00:00:00Z' }, jpeg), /already be expired/);
  assert.equal(db.calls.length, 0);
});

test('older ready AI drafts can still be published with a current activity time', async () => {
  const db = database([{ data: { ...post, activity_at: null } }, { data: { id: 'media-1' } }, {}, { data: published }]);
  await postsService(db).publish('owner', post.id);
  const update = db.calls[2].steps.find(step => step[0] === 'update')[1];
  assert.ok(Math.abs(new Date(update.activity_at).getTime() - Date.now()) < 1000);
});

test('publication retry returns the already published owned post', async () => {
  const db = database([{ data: published }, { data: published }]);
  assert.equal((await postsService(db).publish('owner', post.id)).id, post.id);
  assert.equal(db.calls.some(call => call.steps?.some(step => step[0] === 'update')), false);
});

test('optional AI returns suggestions without creating posts, media, or jobs', async () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const db = database();
    const service = postsService(db);
    service.generateDetails = async () => ({ title: 'Suggested', description: 'From the photo', category: 'Food', labels: ['coffee'] });
    const result = await service.suggest(jpeg);
    assert.equal(result.title, 'Suggested');
    assert.equal(result.activityAt, undefined);
    assert.equal(result.placeName, undefined);
    assert.equal(db.calls.length, 0);
    service.generateDetails = async () => { throw new Error('provider failed'); };
    await assert.rejects(service.suggest(jpeg), /publish manually/);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test('feed passes category, keyword, time, and pagination together to SQL', async () => {
  const db = database([{ data: [] }]);
  await postsService(db).nearby('viewer', { latitude: 1, longitude: 2, radius: 5, limit: 20, offset: 40, category: 'Music', search: '  live  ', time: 'upcoming' });
  assert.equal(db.calls[0].rpc, 'nearby_posts_filtered');
  assert.deepEqual(db.calls[0].args, { p_lat: 1, p_lon: 2, p_radius_miles: 5, p_limit: 20, p_offset: 40, p_category: 'Music', p_search: 'live', p_time: 'upcoming' });
});

test('private and expired posts stay hidden from visitors', async () => {
  for (const hidden of [post, { ...published, expires_at: '2000-01-01T00:00:00Z' }]) {
    await assert.rejects(postsService(database([{ data: hidden }])).post('viewer', post.id), error => error.getStatus() === 404);
  }
});

test('comments return author names and the exact count beyond the loaded page', async () => {
  const db = database([{ data: published }, { data: [comment], count: 251 }, { data: [{ id: 'owner', display_name: 'Alex' }] }]);
  const result = await new CommentsController(db).list(post.id, 'true', 100);
  assert.equal(result.total, 251);
  assert.equal(result.comments[0].authorName, 'Alex');
  assert.deepEqual(db.calls[1].steps.find(step => step[0] === 'range'), ['range', 100, 199]);
});

test('legacy comments callers still receive an array', async () => {
  const db = database([{ data: published }, { data: [comment], count: 1 }, { data: [] }]);
  const result = await new CommentsController(db).list(post.id);
  assert.ok(Array.isArray(result));
  assert.equal(result[0].authorName, 'Member');
});

test('duplicate comment requests return the original without overwriting it', async () => {
  const db = database([{ data: published }, { data: null }, { data: comment }]);
  const result = await new CommentsController(db).add({ userId: 'owner' }, post.id, { body: 'See you there', clientRequestId: 'same-request' });
  assert.deepEqual(result, comment);
  const upsert = db.calls[1].steps.find(step => step[0] === 'upsert');
  assert.equal(upsert[1].author_id, 'owner');
  assert.equal(upsert[1].client_request_id, 'same-request');
  assert.equal(upsert[2].ignoreDuplicates, true);
  assert.ok(db.calls[2].steps.some(step => step[0] === 'eq' && step[1] === 'post_id' && step[2] === post.id));
});

test('comment requests cannot reuse a request ID from another post', async () => {
  const db = database([{ data: published }, { data: null }, { data: null }]);
  await assert.rejects(new CommentsController(db).add({ userId: 'owner' }, post.id, { body: 'Hello', clientRequestId: 'same-request' }), /another activity/);
});

test('blank comments and comments on unavailable activities are rejected', async () => {
  await assert.rejects(new CommentsController(database()).add({ userId: 'owner' }, post.id, { body: '  ' }), /empty/);
  for (const unavailable of [null, post, { ...published, expires_at: '2000-01-01T00:00:00Z' }]) {
    await assert.rejects(new CommentsController(database([{ data: unavailable }])).add({ userId: 'owner' }, post.id, { body: 'Hello' }), /unavailable/);
  }
});

test('DTOs validate required details, timestamps, categories, coordinates, labels, and comment length', async () => {
  assert.equal((await validate(plainToInstance(CreatePostDto, details))).length, 0);
  for (const invalid of [
    { title: ' ' }, { description: ' ' }, { placeName: ' ' }, { category: 'Invalid' },
    { latitude: 91 }, { longitude: -181 }, { activityAt: '2026-02-30T12:00:00Z' },
    { activityAt: '2026-11-14T12:00:00' }, { labels: Array(6).fill('tag') }, { labels: ['x'.repeat(31)] },
  ]) assert.ok((await validate(plainToInstance(CreatePostDto, { ...details, ...invalid }))).length > 0);
  assert.ok((await validate(plainToInstance(AddCommentDto, { body: 'x'.repeat(501) }))).length > 0);
  assert.ok((await validate(plainToInstance(NearbyQuery, { latitude: 1, longitude: 2, time: 'invalid' }))).length > 0);
});

test('authentication still rejects missing and invalid sessions', async () => {
  const guard = new AuthGuard({ client: { auth: { getUser: async () => ({ data: { user: null }, error: {} }) } } });
  for (const headers of [{}, { authorization: 'Bearer invalid' }]) {
    const context = { switchToHttp: () => ({ getRequest: () => ({ headers }) }) };
    await assert.rejects(guard.canActivate(context), error => error.getStatus() === 401);
  }
});


test('a lost create response can be retried without inserting or uploading another post', async () => {
  const requestId = 'f1b7f40a-281e-4bd5-a3ea-5304126c67d8';
  const saved = { ...published, id: requestId };
  const db = database([{ data: saved }, { data: saved }]);
  const result = await postsService(db).create('owner', { ...details, requestId }, jpeg);
  assert.equal(result.id, requestId);
  assert.equal(db.calls.some(call => call.storage || call.steps?.some(step => step[0] === 'insert')), false);
});

test('upload retries reuse the same post and storage key after a network failure', async () => {
  const requestId = 'f1b7f40a-281e-4bd5-a3ea-5304126c67d8';
  const draft = { ...post, id: requestId };
  const saved = { ...published, id: requestId };
  const db = database([
    { data: null }, { data: draft },
    { data: draft }, { data: null }, {}, { data: draft }, { data: { id: 'media-1' } }, {}, { data: saved },
  ], [{ message: 'connection lost' }, null]);
  const service = postsService(db);
  await assert.rejects(service.create('owner', { ...details, requestId }, jpeg), /Image upload failed/);
  const result = await service.create('owner', { ...details, requestId }, jpeg);
  assert.equal(result.id, requestId);
  assert.equal(db.calls.filter(call => call.table === 'posts' && call.steps.some(step => step[0] === 'insert')).length, 1);
  const uploads = db.calls.filter(call => call.storage === 'upload');
  assert.equal(uploads[0].args[0], uploads[1].args[0]);
  assert.equal(uploads[0].args[2].upsert, true);
  assert.equal(db.calls.some(call => call.steps?.some(step => step[0] === 'delete')), false);
  assert.equal(db.queue.length, 0);
});

test('an uploaded retry resumes publication without uploading the photo again', async () => {
  const requestId = 'f1b7f40a-281e-4bd5-a3ea-5304126c67d8';
  const draft = { ...post, id: requestId };
  const db = database([{ data: draft }, { data: { id: 'media-1' } }, { data: draft }, { data: { id: 'media-1' } }, {}, { data: { ...published, id: requestId } }]);
  await postsService(db).create('owner', { ...details, requestId }, jpeg);
  assert.equal(db.calls.some(call => call.storage), false);
});

test('retry IDs cannot access another owner’s post or bypass concurrent insert protection', async () => {
  const requestId = 'f1b7f40a-281e-4bd5-a3ea-5304126c67d8';
  await assert.rejects(postsService(database([{ data: { ...published, id: requestId } }])).create('other', { ...details, requestId }, jpeg), error => error.getStatus() === 403);
  await assert.rejects(postsService(database([{ data: null }, { error: { code: '23505', message: 'duplicate' } }])).create('owner', { ...details, requestId }, jpeg), error => error.getStatus() === 409);
  assert.ok((await validate(plainToInstance(CreatePostDto, { ...details, requestId: 'not-a-uuid' }))).length > 0);
});
