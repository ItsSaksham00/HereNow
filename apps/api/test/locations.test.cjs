// Build the API first. Provider calls are mocked; no account or real API key is used.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ValidationPipe } = require('@nestjs/common');
const { LocationsController } = require('../dist/locations/locations.controller');
const { LocationSearchQuery } = require('../dist/common/dtos');

// Restores the process-only test key after each test; environment files are never read or written.
function providerKey(t, value = 'mock-provider-key') {
  const previous = process.env.GEOAPIFY_API_KEY;
  if (value === undefined) delete process.env.GEOAPIFY_API_KEY;
  else process.env.GEOAPIFY_API_KEY = value;
  t.after(() => {
    if (previous === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = previous;
  });
}
const place = { place_id: 'place-1', lat: 41.1, lon: -80.6, formatted: 'Cafe, Youngstown, OH', address_line1: 'Cafe', address_line2: 'Youngstown, OH' };

test('autocomplete stops at the configuration point without contacting a provider', async t => {
  providerKey(t, '');
  t.mock.method(global, 'fetch', async () => { throw new Error('Provider must not be called'); });
  await assert.rejects(new LocationsController().autocomplete({ userId: 'viewer' }, { q: 'Cafe' }), error => error.getStatus() === 503 && /not set up/.test(error.message));
  assert.equal(fetch.mock.callCount(), 0);
});

test('Geoapify suggestions include real coordinates and distinct primary/secondary labels', async t => {
  providerKey(t);
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url.origin, 'https://api.geoapify.com');
    assert.equal(url.pathname, '/v1/geocode/autocomplete');
    assert.equal(url.searchParams.get('text'), 'Cafe');
    assert.equal(url.searchParams.get('limit'), '5');
    assert.equal(url.searchParams.get('format'), 'json');
    assert.equal(url.searchParams.get('apiKey'), 'mock-provider-key');
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ results: [place] }) };
  });
  const result = await new LocationsController().autocomplete({ userId: 'viewer' }, { q: 'Cafe' });
  assert.deepEqual(result, [{ id: 'place-1', latitude: 41.1, longitude: -80.6, name: place.formatted, primary: 'Cafe', secondary: 'Youngstown, OH', source: 'geoapify', isManual: true }]);
  assert.equal(JSON.stringify(result).includes('mock-provider-key'), false);
});

test('empty provider results stay empty and invalid coordinates are never fabricated', async t => {
  providerKey(t);
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ results: [] }) }));
  assert.deepEqual(await new LocationsController().autocomplete({ userId: 'viewer' }, { q: 'Unknown' }), []);
  fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ results: [
    { ...place, lat: 100 }, { ...place, lon: NaN }, { lat: 41, lon: -80 }, place,
  ] }) }));
  const result = await new LocationsController().autocomplete({ userId: 'viewer' }, { q: 'Cafe' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, place.place_id);
});

test('provider network, timeout, invalid data, and rejected-key failures cannot leak the key', async t => {
  providerKey(t);
  const failure = async () => { throw new Error('upstream URL contained mock-provider-key'); };
  t.mock.method(global, 'fetch', failure);
  for (const implementation of [failure, async () => ({ ok: false, status: 401 }), async () => ({ ok: true, json: async () => ({ bad: true }) })]) {
    fetch.mock.mockImplementation(implementation);
    await assert.rejects(new LocationsController().autocomplete({ userId: 'viewer' }, { q: 'Cafe' }), error => error.getStatus() === 503 && !error.message.includes('mock-provider-key'));
  }
});

test('global provider rate limit rejects a fifth request in the same second', async t => {
  providerKey(t);
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ results: [] }) }));
  const controller = new LocationsController();
  await Promise.all(Array.from({ length: 4 }, (_, index) => controller.autocomplete({ userId: `user-${index}` }, { q: 'Cafe' })));
  await assert.rejects(controller.autocomplete({ userId: 'user-5' }, { q: 'Cafe' }), error => error.getStatus() === 429);
  assert.equal(fetch.mock.callCount(), 4);
  t.mock.timers.tick(1001);
  await controller.autocomplete({ userId: 'user-5' }, { q: 'Cafe' });
});

test('per-user limit bounds minute usage and resets without retaining expired buckets', async t => {
  providerKey(t);
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ results: [] }) }));
  const controller = new LocationsController();
  for (let index = 0; index < 30; index++) {
    t.mock.timers.tick(1000);
    await controller.autocomplete({ userId: 'viewer' }, { q: 'Cafe' });
  }
  await assert.rejects(controller.autocomplete({ userId: 'viewer' }, { q: 'Cafe' }), error => error.getStatus() === 429);
  t.mock.timers.tick(31001);
  await controller.autocomplete({ userId: 'viewer' }, { q: 'Cafe' });
  assert.equal(fetch.mock.callCount(), 31);
});

test('query validation trims text, bounds length, and rejects client-supplied credentials', async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'query', metatype: LocationSearchQuery };
  assert.equal((await pipe.transform({ q: '  Cafe  ' }, metadata)).q, 'Cafe');
  for (const query of [{ q: ' ' }, { q: 'ab' }, { q: 'x'.repeat(121) }, { q: 'Cafe', apiKey: 'client-key' }]) {
    await assert.rejects(pipe.transform(query, metadata), error => error.getStatus() === 400);
  }
});
