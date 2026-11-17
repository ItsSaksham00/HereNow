// Run from the repository root: node --test apps/mobile/test/upload-location.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const Busboy = require('busboy');

// Loads TypeScript with explicit native substitutes, without pretending to run an iPhone.
function load(file, imports, globals = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Blob, Uint8Array, TextEncoder, Error, console, process: { env: {} }, require(name) {
    assert.ok(name in imports, `Unexpected native import: ${name}`);
    return imports[name];
  }, ...globals });
  return exports;
}

// Mirrors the native File interface that Expo's real multipart encoder consumes.
class NativeFile {
  constructor(uri) { this.uri = uri; this.name = 'photo.jpg'; this.type = 'image/jpeg'; this.size = 4; }
  async bytes() { return new Uint8Array([255, 216, 255, 0]); }
}
class NativeFormData { constructor() { this._parts = []; } }
const expoDirectory = path.dirname(require.resolve('expo/package.json'));
const { installFormDataPatch } = load(path.join(expoDirectory, 'src/winter/FormData.ts'), {});
installFormDataPatch(NativeFormData);
const { convertFormDataAsync } = load(path.join(expoDirectory, 'src/winter/fetch/convertFormData.ts'), {
  '../../utils/blobUtils': { blobToArrayBufferAsync: blob => blob.arrayBuffer() },
});

// Parses the resulting bytes with the multipart parser used by the backend stack.
function parseMultipart(body, boundary) {
  return new Promise((resolve, reject) => {
    const parser = Busboy({ headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
    const fields = [], files = [];
    parser.on('field', (name, value) => fields.push([name, value]));
    parser.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => files.push({ name, info, bytes: Buffer.concat(chunks) }));
    });
    parser.on('error', reject);
    parser.on('finish', () => resolve({ fields, files }));
    parser.end(Buffer.from(body));
  });
}

test('the installed Expo encoder reproduces the plain-object upload failure', async () => {
  const form = new NativeFormData();
  form.append('photo', { uri: 'file:///photo.jpg', name: 'photo.jpg', type: 'image/jpeg' });
  await assert.rejects(convertFormDataAsync(form), /Unsupported FormDataPart implementation/);
});

test('photo uploads use supported File parts, preserve auth and field names, and omit a manual boundary', async () => {
  let received;
  const { photoForm, api } = load('apps/mobile/src/lib/api.ts', {
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } } },
    'expo-file-system': { File: NativeFile },
    'expo/fetch': { fetch: async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(options.headers['Content-Type'], undefined);
      const encoded = await convertFormDataAsync(options.body);
      received = await parseMultipart(encoded.body, encoded.boundary);
      return { ok: true, status: 201, text: async () => '{"id":"post-1"}' };
    } },
  }, { FormData: NativeFormData });
  for (const uri of ['file:///camera.jpg', 'file:///gallery.jpg']) {
    const form = photoForm({ uri, mimeType: 'image/jpeg' });
    for (const [name, value] of Object.entries({ requestId: 'request-1', title: 'Coffee', description: 'Join us', category: 'Food', placeName: 'Cafe', latitude: '41', longitude: '-80', activityAt: '2026-12-01T12:00:00Z' })) form.append(name, value);
    form.append('labels[]', 'coffee');
    const result = await api('/posts', { method: 'POST', form });
    assert.equal(result.id, 'post-1');
    assert.equal(received.files.length, 1);
    assert.equal(received.files[0].name, 'photo');
    assert.equal(received.files[0].info.mimeType, 'image/jpeg');
    assert.deepEqual(received.files[0].bytes, Buffer.from([255, 216, 255, 0]));
    assert.ok(received.fields.some(([name, value]) => name === 'labels[]' && value === 'coffee'));
    assert.ok(received.fields.some(([name, value]) => name === 'activityAt' && value === '2026-12-01T12:00:00Z'));
  }
});

test('photo validation rejects empty, oversized, and unsupported files before transport', () => {
  for (const invalid of [{ size: 0 }, { size: 6 * 1024 * 1024 + 1 }, { type: 'image/heic' }]) {
    class InvalidFile extends NativeFile { constructor(uri) { super(uri); Object.assign(this, invalid); } }
    const { photoForm } = load('apps/mobile/src/lib/api.ts', { './supabase': {}, 'expo-file-system': { File: InvalidFile }, 'expo/fetch': {} }, { FormData: NativeFormData });
    assert.throws(() => photoForm({ uri: 'file:///photo.jpg' }));
  }
});

test('API transport failures and server validation errors provide retryable messages', async () => {
  const imports = { './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } } }, 'expo-file-system': { File: NativeFile } };
  let api = load('apps/mobile/src/lib/api.ts', { ...imports, 'expo/fetch': { fetch: async () => { throw new Error('connection lost'); } } }).api;
  await assert.rejects(api('/posts'), /Check your connection and retry/);
  api = load('apps/mobile/src/lib/api.ts', { ...imports, 'expo/fetch': { fetch: async () => ({ ok: false, status: 400, text: async () => '{"message":["Title is required"]}' }) } }).api;
  await assert.rejects(api('/posts'), error => error.status === 400 && error.message === 'Title is required');
});

test('stable iOS geocoding preserves real coordinates and names without requesting GPS', async () => {
  const location = {
    geocodeAsync: async query => { assert.equal(query, 'Youngstown'); return [{ latitude: 41.1, longitude: -80.6 }]; },
    reverseGeocodeAsync: async () => [{ name: 'Downtown', city: 'Youngstown', region: 'OH' }],
  };
  const { findLocations } = load('apps/mobile/src/components/LocationSearch.tsx', {
    react: {}, 'react-native': { Platform: { OS: 'ios' } }, 'expo-location': location, './ui': {}, '../theme/theme': {},
  });
  const matches = await findLocations('  Youngstown  ');
  assert.equal(matches[0].latitude, 41.1);
  assert.equal(matches[0].longitude, -80.6);
  assert.equal(matches[0].name, 'Downtown, Youngstown, OH');
});

test('failed stable lookups never fabricate or fall back to unrelated coordinates', async () => {
  for (const geocodeAsync of [async () => [], async () => [{ latitude: NaN, longitude: 0 }], async () => { throw new Error('offline'); }]) {
    const { findLocations } = load('apps/mobile/src/components/LocationSearch.tsx', { react: {}, 'react-native': { Platform: { OS: 'ios' } }, 'expo-location': { geocodeAsync }, './ui': {}, '../theme/theme': {} });
    try { assert.equal((await findLocations('No such place')).length, 0); }
    catch (error) { assert.match(error.message, /Location search is unavailable/); }
  }
});

test('Android obtains foreground permission before geocoding and uses readable address results', async () => {
  const calls = [];
  const location = {
    getForegroundPermissionsAsync: async () => { calls.push('check'); return { granted: false, canAskAgain: true }; },
    requestForegroundPermissionsAsync: async () => { calls.push('request'); return { granted: true }; },
    geocodeAsync: async () => { calls.push('geocode'); return [{ latitude: 41, longitude: -80 }]; },
    reverseGeocodeAsync: async () => [{ formattedAddress: 'Cafe, Youngstown, OH' }],
  };
  const { findLocations } = load('apps/mobile/src/components/LocationSearch.tsx', { react: {}, 'react-native': { Platform: { OS: 'android' } }, 'expo-location': location, './ui': {}, '../theme/theme': {} });
  const matches = await findLocations('Cafe');
  assert.deepEqual(calls, ['check', 'request', 'geocode']);
  assert.equal(matches[0].name, 'Cafe, Youngstown, OH');
});

test('Android permission denial stops geocoding and explains the manual map alternative', async () => {
  for (const canAskAgain of [true, false]) {
    let requests = 0;
    const location = {
      getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain }),
      requestForegroundPermissionsAsync: async () => { requests++; return { granted: false }; },
      geocodeAsync: async () => { throw new Error('Geocoding must not run without permission'); },
    };
    const { findLocations } = load('apps/mobile/src/components/LocationSearch.tsx', { react: {}, 'react-native': { Platform: { OS: 'android' } }, 'expo-location': location, './ui': {}, '../theme/theme': {} });
    await assert.rejects(findLocations('Cafe'), /Android requires location permission.*pin on the map/);
    assert.equal(requests, canAskAgain ? 1 : 0);
  }
});

test('already-granted Android permission is reused and reverse-geocoder failures keep the actual match', async () => {
  const location = {
    getForegroundPermissionsAsync: async () => ({ granted: true }),
    geocodeAsync: async () => [{ latitude: 41, longitude: -80 }],
    reverseGeocodeAsync: async () => { throw new Error('offline'); },
  };
  const { findLocations } = load('apps/mobile/src/components/LocationSearch.tsx', { react: {}, 'react-native': { Platform: { OS: 'android' } }, 'expo-location': location, './ui': {}, '../theme/theme': {} });
  const matches = await findLocations('Cafe');
  assert.equal(matches[0].name, 'Cafe');
  assert.equal(matches[0].latitude, 41);
  assert.equal(matches[0].longitude, -80);
});

test('mobile application imports never load the beta location module', () => {
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(file);
      else if (/\.tsx?$/.test(file)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /expo-location\/next|LocationModuleNext/, file);
    }
  }
  inspect('apps/mobile/src');
  assert.doesNotMatch(fs.readFileSync('apps/mobile/App.tsx', 'utf8'), /expo-location\/next|LocationModuleNext/);
});
