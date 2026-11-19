// Tests screen state and real handlers with native controls substituted, not live devices.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Reproduces hook updates and cleanup while exposing the screen's native event props.
function screen(file, name, props, overrides = {}) {
  const slots = [], effects = [], dialogs = [];
  let cursor = 0, dirty = false;
  const React = {
    Fragment: 'Fragment', createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(initial) {
      const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { dirty = true; slots[i] = next; } }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(callback, deps) {
      const i = cursor++; if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) slots[i] = { callback, deps };
      return slots[i].callback;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) {
        const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const native = Object.fromEntries(['Image', 'Text', 'View', 'Pressable', 'Switch', 'KeyboardAvoidingView'].map(x => [x, x]));
  const ui = Object.fromEntries(['Btn', 'ErrorText', 'Field', 'Layout', 'Loading', 'Muted', 'Title', 'Select'].map(x => [x, x]));
  const imports = {
    react: React, 'react-native': { ...native, Platform: { OS: 'android' }, StyleSheet: { create: value => value }, Alert: { alert: (...args) => dialogs.push(args) } },
    '../components/ui': ui, '../theme/theme': { C: {} },
    '../lib/api': { api: async () => { throw new Error('Unexpected API request'); }, formatActivityTime: value => value },
    '../lib/supabase': { supabase: { auth: { signOut: async () => ({ error: null }) } } },
    '../components/LocationSearch': { LocationSearch: 'LocationSearch' }, './LocationScreen': {},
    '@react-native-community/datetimepicker': { __esModule: true, default: 'DateTimePicker' },
    'react-native-maps': { __esModule: true, default: 'MapView', Marker: 'Marker' }, ...overrides,
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, console, Date, Set, Error, require(key) { assert.ok(key in imports, `Unexpected import ${key}`); return imports[key]; } });
  function render() {
    let tree, count = 0;
    do { dirty = false; cursor = 0; tree = exports[name](props); while (effects.length) effects.shift()(); assert.ok(++count < 20); } while (dirty);
    return tree;
  }
  function nodes(node, result = []) {
    if (Array.isArray(node)) node.forEach(child => nodes(child, result));
    else if (node?.type) { result.push(node); nodes(node.props.children, result); }
    return result;
  }
  return { exports, render, dialogs,
    find(type, match = () => true) { const found = nodes(render()).find(node => node.type === type && match(node.props)); assert.ok(found, `Missing ${type}`); return found.props; },
    text() { return nodes(render()).map(node => node.props.children.flat(Infinity).filter(child => ['string', 'number'].includes(typeof child)).join('')).join('\n'); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const profileFile = 'apps/mobile/src/screens/ProfileScreen.tsx';
const editFile = 'apps/mobile/src/screens/EditPostScreen.tsx';
const account = { id: 'owner', display_name: 'Alex', email: 'alex@example.test', bio: 'Student', postCount: 57, push_enabled: true };
const post = { id: 'post-1', creator_id: 'owner', isOwn: true, title: 'Coffee', description: 'Join us', category: 'Food', place_name: 'Cafe',
  latitude: 41, longitude: -80, imageUrl: 'https://example.test/photo', status: 'PUBLISHED', activity_at: '2026-11-18T15:00:00.000Z',
  published_at: '2026-11-17T12:00:00.000Z', created_at: '2026-11-17T12:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z', interestCount: 12 };
function apiImport(api) { return { api, formatActivityTime: value => value }; }

// Distinguishes the count query from the paged My Posts requests.
function profileScreen(api, props = {}, overrides = {}) {
  return screen(profileFile, 'ProfileScreen', { onPost() {}, onEdit() {}, onChangeLocation() {}, ...props }, { '../lib/api': apiImport(api), ...overrides });
}

test('profile shows authenticated email, initials, exact statistics, photo, activity time, and interest totals', async () => {
  const h = profileScreen(async path => path === '/users/me' ? account : [post]);
  h.render(); await tick();
  assert.match(h.text(), /Alex/); assert.match(h.text(), /alex@example.test/); assert.match(h.text(), /57 posts created/);
  assert.match(h.text(), /12 interested/); assert.match(h.text(), /2026-11-18T15:00/);
  assert.equal(h.find('Image').source.uri, post.imageUrl);
});

test('display name and bio save through the backend and survive a refreshed profile load', async () => {
  let saved = { ...account }, mutations = 0;
  const h = profileScreen(async (path, options) => {
    if (options?.method === 'PATCH') { mutations++; saved = { ...saved, display_name: options.body.displayName, bio: options.body.bio }; return saved; }
    return path === '/users/me' ? saved : [];
  });
  h.render(); await tick(); h.find('Btn', p => p.label === 'Edit Profile').onPress();
  h.find('Field', p => p.label === 'Display name').onChangeText('  Taylor  ');
  h.find('Field', p => p.label === 'Bio (optional)').onChangeText('  New bio  ');
  const save = h.find('Btn', p => p.label === 'Save profile').onPress;
  save(); save(); await tick();
  assert.equal(mutations, 1); assert.equal(saved.display_name, 'Taylor'); assert.equal(saved.bio, 'New bio');
  h.find('Layout').onRefresh(); await tick(); assert.match(h.text(), /Taylor/); assert.match(h.text(), /New bio/);
});

test('failed profile saves retain edits for retry and blank names never reach the backend', async () => {
  let fail = true, writes = 0;
  const h = profileScreen(async (path, options) => {
    if (options?.method) { writes++; if (fail) throw new Error('Offline'); return { ...account, display_name: options.body.displayName }; }
    return path === '/users/me' ? account : [];
  });
  h.render(); await tick(); h.find('Btn', p => p.label === 'Edit Profile').onPress();
  h.find('Field', p => p.label === 'Display name').onChangeText(' ');
  h.find('Btn', p => p.label === 'Save profile').onPress(); await tick(); assert.equal(writes, 0);
  h.find('Field', p => p.label === 'Display name').onChangeText('Taylor');
  h.find('Btn', p => p.label === 'Save profile').onPress(); await tick();
  assert.equal(h.find('ErrorText').message, 'Offline'); assert.equal(h.find('Field', p => p.label === 'Display name').value, 'Taylor');
  fail = false; h.find('Btn', p => p.label === 'Save profile').onPress(); await tick(); assert.equal(writes, 2);
});

test('My Posts filters request matching server pages and ignore slow older responses', async () => {
  let resolveOld;
  const paths = [];
  const h = profileScreen(async path => {
    paths.push(path); if (path === '/users/me') return account;
    if (path.includes('filter=active')) return new Promise(resolve => { resolveOld = resolve; });
    return [{ ...post, title: 'Upcoming result' }];
  });
  h.render(); h.find('Pressable', p => p.key === 'upcoming').onPress(); h.render(); await tick();
  resolveOld([{ ...post, title: 'Old result' }]); await tick();
  assert.match(h.text(), /Upcoming result/); assert.doesNotMatch(h.text(), /Old result/);
  assert.ok(paths.some(path => path.includes('filter=upcoming&limit=20&offset=0')));
});

test('pagination loads beyond twenty posts without duplicates and supports opening and editing', async () => {
  let opened, edited;
  const first = Array.from({ length: 20 }, (_, i) => ({ ...post, id: `post-${i}` }));
  const h = profileScreen(async path => path === '/users/me' ? account : path.includes('offset=20') ? [first[19], { ...post, id: 'last', title: 'Last result' }] : first,
    { onPost: id => { opened = id; }, onEdit: id => { edited = id; } });
  h.render(); await tick(); h.find('Btn', p => p.label === 'Load more posts').onPress(); await tick();
  assert.match(h.text(), /Last result/); assert.throws(() => h.find('Btn', p => p.label === 'Load more posts'));
  h.find('Pressable', p => !p.key).onPress(); assert.equal(opened, 'post-0');
  h.find('Text', p => p.children.includes('Edit')).onPress(); assert.equal(edited, 'post-0');
});

test('delete waits for confirmation, failures are retryable, and successful deletion reloads rows and statistics', async () => {
  let deleted = false, fail = true, requests = 0;
  const h = profileScreen(async (path, options) => {
    if (options?.method === 'DELETE') { requests++; if (fail) throw new Error('Connection lost'); deleted = true; return { deleted: true }; }
    return path === '/users/me' ? { ...account, postCount: deleted ? 56 : 57 } : deleted ? [] : [post];
  });
  h.render(); await tick(); h.find('Text', p => p.children.includes('Delete')).onPress();
  assert.equal(requests, 0); assert.equal(h.dialogs[0][0], 'Delete this activity?'); assert.equal(h.dialogs[0][1], 'This action cannot be undone.');
  await h.dialogs[0][2][1].onPress(); assert.equal(h.find('ErrorText').message, 'Connection lost');
  fail = false; h.find('Text', p => p.children.includes('Delete')).onPress(); await h.dialogs[1][2][1].onPress();
  assert.equal(requests, 2); assert.match(h.text(), /56 posts created/); assert.doesNotMatch(h.text(), /Coffee/);
});

test('initial loading failures remain visible with retry and logout still available', async () => {
  let fail = true, signouts = 0;
  const h = profileScreen(async path => { if (fail) throw new Error('Offline'); return path === '/users/me' ? account : []; }, {}, {
    '../lib/supabase': { supabase: { auth: { signOut: async () => { signouts++; return { error: new Error('Try again') }; } } } },
  });
  h.render(); await tick(); assert.equal(h.find('ErrorText').message, 'Offline');
  await h.find('Btn', p => p.label === 'Log out').onPress(); assert.equal(signouts, 1); assert.equal(h.find('ErrorText').message, 'Try again');
  fail = false; h.find('Btn', p => p.label === 'Retry loading').onPress(); await tick(); assert.match(h.text(), /Alex/);
});

test('expired badges use deadlines and unpublished statuses remain distinct', () => {
  const h = profileScreen(async () => []);
  assert.equal(h.exports.ownPostStatus({ ...post, expires_at: '2020-01-01' }), 'Expired');
  assert.equal(h.exports.ownPostStatus({ ...post, status: 'READY', expires_at: null }), 'Ready');
  assert.equal(h.exports.ownPostStatus({ ...post, activity_at: '2098-01-01' }), 'Upcoming');
});

test('activity editing preserves unchanged time and photo and submits only editable details', async () => {
  let body, saved, writes = 0;
  const h = screen(editFile, 'EditPostScreen', { id: post.id, onBack() {}, onSaved: id => { saved = id; } }, {
    '../lib/api': apiImport(async (_path, options) => { if (!options) return post; writes++; body = options.body; return post; }),
  });
  h.render(); await tick(); h.find('Field', p => p.label === 'Activity title').onChangeText(' New title ');
  const save = h.find('Btn', p => p.label === 'Save changes').onPress; save(); save(); await tick();
  assert.equal(writes, 1); assert.equal(saved, post.id); assert.equal(body.title, 'New title'); assert.equal(body.activityAt, post.activity_at);
  assert.equal(body.latitude, post.latitude); assert.equal('imageUrl' in body, false); assert.equal('expires_at' in body, false);
  assert.equal('creator_id' in body, false); assert.equal('interestCount' in body, false);
});

test('edit selection needs no map tap and native date changes reach the saved request', async () => {
  let body;
  const h = screen(editFile, 'EditPostScreen', { id: post.id, onBack() {}, onSaved() {} }, {
    '../lib/api': apiImport(async (_path, options) => { if (!options) return post; body = options.body; return post; }),
  });
  h.render(); await tick(); h.find('LocationSearch').onSelect({ latitude: 40.71284, longitude: -74.00602, name: 'New York' });
  h.find('Btn', p => p.label === 'Change date').onPress();
  h.find('DateTimePicker').onChange({}, new Date('2026-12-01T15:00:00.000Z'));
  await h.find('Btn', p => p.label === 'Save changes').onPress();
  assert.equal(body.latitude, 40.713); assert.equal(body.placeName, 'New York'); assert.equal(body.activityAt, '2026-12-01T15:00:00.000Z');
});

test('non-owner edit attempts never display editable fields and save failures keep the form for retry', async () => {
  const denied = screen(editFile, 'EditPostScreen', { id: post.id }, { '../lib/api': apiImport(async () => ({ ...post, isOwn: false })) });
  denied.render(); await tick(); assert.match(denied.find('ErrorText').message, /Only the creator/); assert.throws(() => denied.find('Field'));
  let writes = 0;
  const h = screen(editFile, 'EditPostScreen', { id: post.id, onSaved() {} }, {
    '../lib/api': apiImport(async (_path, options) => { if (!options) return post; if (++writes === 1) throw new Error('Offline'); return post; }),
  });
  h.render(); await tick(); await h.find('Btn', p => p.label === 'Save changes').onPress();
  assert.equal(h.find('ErrorText').message, 'Offline'); assert.equal(h.find('Field', p => p.label === 'Activity title').value, 'Coffee');
  await h.find('Btn', p => p.label === 'Save changes').onPress(); assert.equal(writes, 2);
});

test('photo cleanup retry stays available after a refresh removes the deleted card', async () => {
  let deleted = false, attempts = 0;
  const h = profileScreen(async (path, options) => {
    if (options?.method === 'DELETE') {
      deleted = true; if (++attempts === 1) throw new Error('Activity deleted, but photo cleanup failed. Retry deleting to finish.');
      return { deleted: true };
    }
    return path === '/users/me' ? account : deleted ? [] : [post];
  });
  h.render(); await tick(); h.find('Text', p => p.children.includes('Delete')).onPress(); await h.dialogs[0][2][1].onPress();
  h.find('Layout').onRefresh(); await tick(); assert.doesNotMatch(h.text(), /Coffee/);
  h.find('Btn', p => p.label === 'Retry deleting').onPress(); await h.dialogs[1][2][1].onPress();
  assert.equal(attempts, 2); assert.throws(() => h.find('Btn', p => p.label === 'Retry deleting'));
});

test('pagination advances past duplicate pages rather than fetching the same offset forever', async () => {
  const pages = [], first = Array.from({ length: 20 }, (_, id) => ({ ...post, id: `post-${id}` }));
  const h = profileScreen(async path => {
    if (path === '/users/me') return account;
    pages.push(path);
    if (path.includes('offset=40')) return [{ ...post, id: 'last', title: 'Final activity' }];
    return first;
  });
  h.render(); await tick();
  h.find('Btn', p => p.label === 'Load more posts').onPress(); await tick();
  h.find('Btn', p => p.label === 'Load more posts').onPress(); await tick();
  assert.ok(pages[1].includes('offset=20')); assert.ok(pages[2].includes('offset=40'));
  assert.match(h.text(), /Final activity/); assert.throws(() => h.find('Btn', p => p.label === 'Load more posts'));
});
