// Tests real screen handlers with substituted native controls, not physical-device layouts.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Supplies the small hook surface needed to inspect screen state and event handlers.
function screen(file, name, props, api) {
  const slots = [], effects = [];
  let cursor = 0;
  const React = {
    Fragment: 'Fragment',
    createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, offset) => value !== slots[index].dependencies[offset])) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, offset) => value !== slots[index][offset])) { slots[index] = dependencies; effects.push(effect); }
    },
  };
  const controls = Object.fromEntries(['Text', 'TextInput', 'View', 'Image', 'Pressable', 'ScrollView', 'RefreshControl', 'KeyboardAvoidingView'].map(control => [control, control]));
  const ui = Object.fromEntries(['Btn', 'ErrorText', 'Layout', 'Loading', 'Muted', 'Title', 'IconButton', 'LabelChip'].map(control => [control, control]));
  const imports = {
    react: React,
    'react-native': { ...controls, Alert: { alert() {} }, Platform: { OS: 'ios' }, StyleSheet: { create: styles => styles } },
    '../lib/api': { api, timeAgo: () => 'Just now', formatActivityTime: () => 'Activity time', milesBetween: () => 1,
      nearbyUrl: () => '/posts/nearby', activityFilters: [{ value: 'now', label: 'Now' }] },
    '../components/ui': ui, '../components/LocationSearch': { LocationCredits: 'LocationCredits' }, '../theme/theme': { C: {} },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, Date, Math, Error, console,
    setTimeout: callback => { queueMicrotask(callback); return 1; }, clearTimeout() {},
    require: key => { assert.ok(key in imports, `Unexpected native import: ${key}`); return imports[key]; },
  });
  function render() { cursor = 0; const tree = exports[name](props); while (effects.length) effects.shift()(); return tree; }
  function elements(node, result = []) {
    if (Array.isArray(node)) node.forEach(child => elements(child, result));
    else if (node && typeof node === 'object' && node.type) {
      result.push(node);
      elements(node.props.children, result);
      elements(node.props.refreshControl, result);
    }
    return result;
  }
  return { render, find(type, predicate = () => true) {
    const found = elements(render()).find(node => node.type === type && predicate(node.props));
    assert.ok(found, `Missing ${type}`);
    return found.props;
  }, text() {
    return elements(render()).filter(node => node.type === 'Text').map(node => node.props.children.flat(Infinity).filter(value => typeof value === 'string' || typeof value === 'number').join('')).join('\n');
  } };
}

const initialPost = { id: 'post-1', creator_id: 'owner', creatorName: 'Creator', status: 'PUBLISHED', isOwn: false, interested: false, interestCount: 12, title: 'Coffee', place_name: 'Cafe', latitude: 41, longitude: -80, created_at: new Date().toISOString() };
const detailFile = 'apps/mobile/src/screens/PostDetailScreen.tsx';

test('Let’s Go double taps use one request and show the server count on refresh and reopen', async () => {
  let current = { ...initialPost }, submissions = 0;
  const api = async (path, options) => {
    if (options?.method === 'POST') { submissions++; current = { ...current, interested: true, interestCount: 13 }; return { id: 'interest-1', created: true }; }
    if (path.startsWith('/comments')) return { comments: [], total: 0 };
    return current;
  };
  const details = screen(detailFile, 'PostDetailScreen', { id: current.id, onBack() {} }, api);
  details.render(); await tick();
  const join = details.find('Btn', props => props.label === 'Let’s Go · 12').onPress;
  await Promise.all([join(), join()]);
  assert.equal(submissions, 1);
  assert.equal(details.find('Btn', props => props.label === 'Interested ✓ · 13').disabled, true);
  const reopened = screen(detailFile, 'PostDetailScreen', { id: current.id, onBack() {} }, api);
  reopened.render(); await tick();
  assert.equal(reopened.find('Btn', props => props.label === 'Interested ✓ · 13').disabled, true);
  const feed = screen('apps/mobile/src/screens/FeedScreen.tsx', 'FeedScreen', { center: { latitude: 41, longitude: -80 }, radius: 10, category: 'All', time: 'now', search: '', onCategoryChange() {}, onTimeChange() {}, onSearchChange() {}, onRadiusChange() {}, onPost() {}, onMap() {}, onLocation() {} }, async () => [current]);
  feed.render(); await tick();
  assert.match(feed.text(), /Interested ✓ · 13/);
});

test('an already-created interest response does not optimistically increment the total again', async () => {
  let joined = false;
  const details = screen(detailFile, 'PostDetailScreen', { id: initialPost.id, onBack() {} }, async (path, options) => {
    if (options?.method === 'POST') { joined = true; return { id: 'interest-1', created: false }; }
    if (path.startsWith('/comments')) return { comments: [], total: 0 };
    return { ...initialPost, interested: joined, interestCount: 12 };
  });
  details.render(); await tick();
  await details.find('Btn', props => props.label === 'Let’s Go · 12').onPress();
  assert.equal(details.find('Btn', props => props.label === 'Interested ✓ · 12').disabled, true);
});

test('owners can see the count without receiving a Let’s Go button', async () => {
  const details = screen(detailFile, 'PostDetailScreen', { id: initialPost.id, onBack() {} }, async path => path.startsWith('/comments') ? { comments: [], total: 0 } : { ...initialPost, isOwn: true });
  details.render(); await tick();
  assert.throws(() => details.find('Btn', props => props.label.startsWith('Let’s Go')));
  assert.match(details.find('Muted', props => props.children.includes(12)).children.join(''), /12 interested/);
});

test('comment pagination keeps the exact total and shows the author and persisted body', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `comment-${index}`, authorName: 'Alex', body: `Comment ${index}`, created_at: new Date().toISOString() }));
  const details = screen(detailFile, 'PostDetailScreen', { id: initialPost.id, onBack() {} }, async path => {
    if (path.includes('offset=100')) return { comments: [{ id: 'comment-100', authorName: 'Sam', body: 'Last comment', created_at: new Date().toISOString() }], total: 101 };
    if (path.startsWith('/comments')) return { comments: firstPage, total: 101 };
    return initialPost;
  });
  details.render(); await tick();
  assert.match(details.text(), /Comments \(101\)/);
  details.find('Btn', props => props.label === 'Load more comments').onPress(); await tick();
  assert.match(details.text(), /Sam/);
  assert.match(details.text(), /Last comment/);
  assert.throws(() => details.find('Btn', props => props.label === 'Load more comments'));
});

test('notification read failures are retryable and successful reads open the correct post', async () => {
  let failing = true, opened = null;
  const notice = { id: 'notice-1', post_id: initialPost.id, message: 'Alex wants to join Coffee', created_at: new Date().toISOString(), is_read: false };
  const inbox = screen('apps/mobile/src/screens/ActivityScreen.tsx', 'ActivityScreen', { onPost: postId => { opened = postId; } }, async (_path, options) => {
    if (options?.method === 'PATCH') { if (failing) throw new Error('Connection lost'); return { id: notice.id, is_read: true }; }
    return [notice];
  });
  inbox.render(); await tick();
  inbox.find('Pressable').onPress(); await tick();
  assert.equal(opened, null);
  assert.equal(inbox.find('ErrorText').message, 'Connection lost');
  failing = false;
  inbox.find('Pressable').onPress(); await tick();
  assert.equal(opened, initialPost.id);
  assert.equal(inbox.find('Text', props => props.children.includes(notice.message)).style.fontWeight, '400');
});

test('a slow older refresh cannot overwrite the interest count loaded after joining', async () => {
  let reads = 0, resolveOld;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const details = screen(detailFile, 'PostDetailScreen', { id: initialPost.id, onBack() {} }, async (path, options) => {
    if (options?.method === 'POST') return { id: 'interest-1', created: true };
    if (path.startsWith('/comments')) return { comments: [], total: 0 };
    reads++;
    if (reads === 2) return oldResponse;
    return reads === 1 ? initialPost : { ...initialPost, interested: true, interestCount: 13 };
  });
  details.render(); await tick();
  const join = details.find('Btn', props => props.label === 'Let’s Go · 12').onPress;
  details.find('RefreshControl').onRefresh();
  await join();
  resolveOld(initialPost); await tick();
  assert.equal(details.find('Btn', props => props.label === 'Interested ✓ · 13').disabled, true);
});

test('posting a comment does not make the interest counter claim an interest is being sent', async () => {
  let finishComment;
  const submitted = new Promise(resolve => { finishComment = resolve; });
  const details = screen(detailFile, 'PostDetailScreen', { id: initialPost.id, onBack() {} }, async (path, options) => {
    if (options?.method === 'POST' && path.startsWith('/comments')) return submitted;
    if (path.startsWith('/comments')) return { comments: [], total: 0 };
    return initialPost;
  });
  details.render(); await tick();
  details.find('TextInput').onChangeText('See you there');
  const posting = details.find('Btn', props => props.label === 'Post comment').onPress();
  assert.equal(details.find('Btn', props => props.label === 'Let’s Go · 12').disabled, true);
  assert.equal(details.find('Btn', props => props.label === 'Posting…').disabled, true);
  finishComment({ id: 'comment-1' }); await posting;
});

test('deleted activity links show an error and a 404 refresh clears any previously loaded activity', async () => {
  let deleted = false;
  const api = async path => {
    if (path.startsWith('/comments')) return { comments: [], total: 0 };
    if (deleted) throw Object.assign(new Error('Activity not found'), { status: 404 });
    return initialPost;
  };
  const details = screen(detailFile, 'PostDetailScreen', { id: initialPost.id, onBack() {} }, api);
  details.render(); await tick(); assert.match(details.text(), /Cafe/);
  deleted = true; details.find('RefreshControl').onRefresh(); await tick();
  assert.equal(details.find('ErrorText').message, 'Activity not found'); assert.doesNotMatch(details.text(), /Cafe/);
  const staleLink = screen(detailFile, 'PostDetailScreen', { id: initialPost.id, onBack() {} }, api);
  staleLink.render(); await tick(); assert.equal(staleLink.find('ErrorText').message, 'Activity not found');
});
