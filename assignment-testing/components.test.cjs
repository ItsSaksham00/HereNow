require('reflect-metadata');
const assert = require('node:assert/strict');
const { describe, test, before, after, beforeEach } = require('node:test');
const { ValidationPipe } = require('@nestjs/common');
const { PostsController } = require('../apps/api/dist/posts/posts.controller');
const { PostsService } = require('../apps/api/dist/posts/posts.service');
const { NearbyQuery } = require('../apps/api/dist/common/dtos');
const fakeSupabase = require('./fake-supabase.cjs');

const post = {
  id: 'post-1', creator_id: 'student-1', title: 'Study Group', description: 'Review chapter one.',
  category: 'Social', place_name: 'Library', latitude: 41, longitude: -80,
  status: 'READY', activity_at: '2026-11-18T15:00:00.000Z',
};
const originalLifetime = process.env.POST_LIFETIME_HOURS;
before(() => { process.env.POST_LIFETIME_HOURS = '4'; });
after(() => {
  if (originalLifetime === undefined) delete process.env.POST_LIFETIME_HOURS;
  else process.env.POST_LIFETIME_HOURS = originalLifetime;
});
beforeEach(t => { t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-18T15:00:00.000Z') }); });

describe('C1 - Activity publishing: real controller and service', () => {
  // Checks publication, expiration, and response enrichment through real modules.
  test('C1-01 publishes a ready Study Group with its saved photo', async t => {
    const { db, state } = fakeSupabase(post);
    const controller = new PostsController(new PostsService(db));
    const result = await controller.publish({ userId: 'student-1' }, post.id);
    assert.equal(result.status, 'PUBLISHED');
    assert.equal(result.expires_at, '2026-11-18T19:00:00.000Z');
    assert.equal(result.imageUrl, 'https://images.example.test/study.jpg');
    assert.equal(result.interestCount, 2);
    assert.equal(result.isOwn, true);
    assert.equal(state.writes.length, 1);
    const targets = state.filters.filter(filter => filter.table === 'posts' && filter.column === 'id');
    assert.equal(targets.length > 0 && targets.every(filter => filter.value === post.id), true);
    assert.deepEqual(state.signatures[0], { bucket: 'post-images', objectKey: 'student-1/post-1/photo.jpg', expires: 3600 });
    t.diagnostic(JSON.stringify({ id: 'C1-01', actual: `${result.status}; ${result.expires_at}`, expected: 'PUBLISHED; 2026-11-18T19:00:00.000Z' }));
  });

  // Checks the unusual case of repeating a successful publication request.
  test('C1-02 returns an already published activity without writing again', async t => {
    const published = { ...post, status: 'PUBLISHED', expires_at: '2026-11-18T19:00:00.000Z' };
    const { db, state } = fakeSupabase(published);
    const result = await new PostsController(new PostsService(db)).publish({ userId: 'student-1' }, post.id);
    assert.equal(result.status, 'PUBLISHED');
    assert.equal(result.expires_at, published.expires_at);
    assert.equal(state.writes.length, 0);
    t.diagnostic(JSON.stringify({ id: 'C1-02', actual: state.writes.length, expected: 0 }));
  });

  // Checks that an external update failure propagates instead of reporting publication.
  test('C1-03 reports a database update failure and keeps the saved status READY', async t => {
    const log = t.mock.method(console, 'error', () => {});
    const { db, state } = fakeSupabase(post, 'update');
    let actual;
    await assert.rejects(new PostsController(new PostsService(db)).publish({ userId: 'student-1' }, post.id), error => {
      actual = error.getStatus(); return actual === 500 && error.message === 'Database or storage request failed';
    });
    assert.equal(state.post.status, 'READY');
    assert.equal(log.mock.callCount(), 1);
    t.diagnostic(JSON.stringify({ id: 'C1-03', actual, expected: 500 }));
  });
});

describe('C2 - Nearby discovery: real DTO, controller, service, and enrichment', () => {
  // Checks validated filters and the combined creator/photo/interest response.
  test('C2-01 retrieves and enriches a filtered nearby Study Group', async t => {
    const { db, state } = fakeSupabase({ ...post, status: 'PUBLISHED', activity_at: '2026-12-01T12:00:00.000Z', expires_at: '2026-12-01T16:00:00.000Z' });
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const query = await pipe.transform({ latitude: '41', longitude: '-80', radius: '5', category: 'Social', search: ' Study ', time: 'upcoming' }, { type: 'query', metatype: NearbyQuery });
    const result = await new PostsController(new PostsService(db)).nearby({ userId: 'viewer-1' }, query);
    assert.deepEqual(state.rpcs[0], { name: 'nearby_posts_filtered', args: {
      p_lat: 41, p_lon: -80, p_radius_miles: 5, p_limit: 20, p_offset: 0,
      p_category: 'Social', p_search: 'Study', p_time: 'upcoming',
    } });
    assert.equal(result.length, 1);
    assert.equal(result[0].creatorName, 'Student');
    assert.equal(result[0].interestCount, 2);
    assert.equal(result[0].isOwn, false);
    assert.equal(result[0].imageUrl, 'https://images.example.test/study.jpg');
    t.diagnostic(JSON.stringify({ id: 'C2-01', actual: `${result.length} activity; ${result[0].interestCount} interested`, expected: '1 activity; 2 interested' }));
  });

  // Checks that empty search results avoid unnecessary enrichment calls.
  test('C2-02 returns an empty feed without profile, photo, or interest requests', async t => {
    const { db, state } = fakeSupabase(post);
    state.nearbyRows = [];
    const query = Object.assign(new NearbyQuery(), { latitude: 41, longitude: -80 });
    const result = await new PostsController(new PostsService(db)).nearby({ userId: 'viewer-1' }, query);
    assert.deepEqual(result, []);
    assert.equal(state.rpcs.length, 1);
    assert.equal(state.tables.length, 0);
    assert.equal(state.signedPhotos, 0);
    t.diagnostic(JSON.stringify({ id: 'C2-02', actual: result, expected: [] }));
  });

  // Checks that a failed summary dependency is not silently shown as zero interest.
  test('C2-03 propagates an interest-summary failure instead of returning a partial feed', async t => {
    const log = t.mock.method(console, 'error', () => {});
    const { db, state } = fakeSupabase({ ...post, status: 'PUBLISHED', expires_at: '2026-11-18T19:00:00.000Z' }, 'summary');
    const query = Object.assign(new NearbyQuery(), { latitude: 41, longitude: -80 });
    let actual;
    await assert.rejects(new PostsController(new PostsService(db)).nearby({ userId: 'viewer-1' }, query), error => {
      actual = error.getStatus(); return actual === 500 && error.message === 'Database or storage request failed';
    });
    assert.equal(state.rpcs[1].name, 'post_interest_summary');
    assert.equal(state.signedPhotos, 0);
    assert.equal(log.mock.callCount(), 1);
    t.diagnostic(JSON.stringify({ id: 'C2-03', actual, expected: 500 }));
  });
});
