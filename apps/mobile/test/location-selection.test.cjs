// Exercises real location handlers with controlled hooks, timers, and native substitutes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));

function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) { now += ms; for (const [id, task] of timers) if (task.at <= now) { timers.delete(id); task.fn(); } },
  };
}

// Runs effect cleanup on dependency changes and unmount, including aborted requests.
function harness(file, name, props, extra = {}, time = clock(), append = '') {
  const slots = [], effects = [];
  let cursor = 0, dirty = false;
  const React = {
    createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) {
        const old = slots[i]; slots[i] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const controls = Object.fromEntries(['Text', 'View', 'TextInput', 'Pressable', 'ScrollView', 'Image', 'KeyboardAvoidingView'].map(x => [x, x]));
  const imports = {
    react: React,
    'react-native': { ...controls, Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, Linking: {}, StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 400, height: 800 }), Alert: { alert(_title, _body, buttons) { buttons[1].onPress(); } } },
    '../components/ui': Object.fromEntries(['Btn', 'ErrorText', 'Layout', 'Loading', 'Muted', 'Select', 'Title', 'IconButton', 'LabelChip'].map(x => [x, x])),
    './ui': { ErrorText: 'ErrorText', Muted: 'Muted', styles: {} },
    '../theme/theme': { C: {} },
    ...extra,
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8') + append, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, AbortController, Promise, Date, console, ...time, require(key) { assert.ok(key in imports, `Unexpected import ${key}`); return imports[key]; } });
  function render() {
    let tree, count = 0;
    do { dirty = false; cursor = 0; tree = exports[name](props); while (effects.length) effects.shift()(); assert.ok(++count < 20, 'render loop'); } while (dirty);
    return tree;
  }
  function nodes(node, result = []) {
    if (Array.isArray(node)) node.forEach(child => nodes(child, result));
    else if (node?.type) { result.push(node); nodes(node.props.children, result); }
    return result;
  }
  return { exports, time, render, update(next) { props = next; return render(); },
    find(type, match = () => true) { const node = nodes(render()).find(n => n.type === type && match(n.props)); assert.ok(node, `Missing ${type}`); return node.props; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

const searchFile = 'apps/mobile/src/components/LocationSearch.tsx';
const place = { id: 'p', latitude: 40.7, longitude: -74, name: 'New York, USA', primary: 'New York', secondary: 'USA', source: 'geoapify' };

test('autocomplete debounces for 350ms, selects real coordinates directly, and clears without another lookup', async () => {
  let requests = 0, selected;
  const h = harness(searchFile, 'LocationSearch', { onSelect: value => { selected = value; } }, { '../lib/api': { api: async () => { requests++; return [place]; } } });
  h.find('TextInput').onChangeText('New'); h.render();
  h.time.advance(349); await tick(); assert.equal(requests, 0);
  h.time.advance(1); await tick(); assert.equal(requests, 1);
  assert.ok(h.find('Muted', p => p.children.includes('USA')));
  h.find('Pressable', p => !p.accessibilityLabel).onPress();
  assert.equal(selected.latitude, 40.7); assert.equal(selected.longitude, -74);
  assert.equal(h.find('TextInput').value, place.name);
  assert.throws(() => h.find('Pressable', p => !p.accessibilityLabel));
  h.find('Pressable', p => p.accessibilityLabel === 'Clear location search').onPress(); h.render();
  h.time.advance(1000); await tick(); assert.equal(requests, 1); assert.equal(h.find('TextInput').value, '');
});

test('older responses are aborted and ignored after another query or a new selected GPS location', async () => {
  const requests = [];
  const h = harness(searchFile, 'LocationSearch', { onSelect() {} }, { '../lib/api': { api: (_url, options) => new Promise(resolve => requests.push({ resolve, signal: options.signal })) } });
  h.find('TextInput').onChangeText('Old'); h.render(); h.time.advance(350);
  h.find('TextInput').onChangeText('New'); h.render(); h.time.advance(350);
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve([place]); await tick();
  requests[0].resolve([{ ...place, primary: 'Outdated' }]); await tick();
  assert.throws(() => h.find('Text', p => p.children.includes('Outdated')));
  h.update({ onSelect() {}, selected: { latitude: 41, longitude: -80, name: 'GPS' } });
  assert.equal(h.find('TextInput').value, 'GPS');
  assert.throws(() => h.find('Pressable', p => !p.accessibilityLabel));
});

test('empty and unavailable autocomplete results preserve the selected area', async () => {
  let fail = false, selections = 0;
  const h = harness(searchFile, 'LocationSearch', { selected: place, onSelect() { selections++; } }, { '../lib/api': { api: async () => { if (fail) throw new Error('Location suggestions are not set up yet.'); return []; } } });
  h.find('TextInput').onChangeText('Unknown'); h.render(); h.time.advance(350); await tick();
  assert.match(h.find('ErrorText').message, /No places found/);
  fail = true;
  h.find('TextInput').onChangeText('Another'); h.render(); h.time.advance(350); await tick();
  assert.match(h.find('ErrorText').message, /not set up/); assert.equal(selections, 0);
});

function gps(overrides = {}, time = clock()) {
  return harness('apps/mobile/src/screens/LocationScreen.tsx', 'LocationScreen', {}, { 'expo-location': {
    Accuracy: { Balanced: 3 }, getForegroundPermissionsAsync: async () => ({ granted: true }),
    requestForegroundPermissionsAsync: async () => ({ granted: true }), hasServicesEnabledAsync: async () => true,
    getCurrentPositionAsync: async () => ({ coords: { latitude: 41.12345, longitude: -80.12345 } }),
    reverseGeocodeAsync: async () => [{ formattedAddress: 'Current address' }], ...overrides,
  } }, time);
}

test('GPS checks existing permission, requests after explanation, and retains coordinates when reverse lookup fails', async () => {
  let requests = 0;
  const h = gps({ getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
    requestForegroundPermissionsAsync: async () => { requests++; return { granted: true }; }, reverseGeocodeAsync: async () => { throw new Error('offline'); } });
  const result = await h.exports.getDeviceCenter();
  assert.equal(requests, 1); assert.equal(result.latitude, 41.12345); assert.equal(result.name, 'Near you');
});

test('denied permission and disabled services never request a position', async () => {
  for (const overrides of [{ getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: false }) }, { hasServicesEnabledAsync: async () => false }]) {
    let positions = 0;
    const h = gps({ ...overrides, getCurrentPositionAsync: async () => { positions++; } });
    await assert.rejects(h.exports.getDeviceCenter(), /denied|Services are off/); assert.equal(positions, 0);
  }
});

test('GPS times out after 20 seconds rather than waiting indefinitely', async () => {
  const h = gps({ getCurrentPositionAsync: () => new Promise(() => {}) });
  const pending = h.exports.getDeviceCenter();
  const rejected = assert.rejects(pending, /timed out/);
  await tick(); h.time.advance(20000); await rejected;
});

const mapFile = 'apps/mobile/src/screens/MapScreen.tsx';
test('returning from a manual location to GPS preserves radius and filters, supports repeats, and keeps selection on failure', async () => {
  let props = { center: place, radius: 5, category: 'Food', time: 'upcoming', search: 'coffee', onTimeChange() {}, onRadiusChange() {}, onSelect() {}, onPost() {}, onBack() {} };
  let fail = false, gpsCalls = 0;
  const queries = [];
  props.onCenterChange = center => { props = { ...props, center }; h.update(props); };
  const h = harness(mapFile, 'MapScreen', props, {
    'react-native-maps': { __esModule: true, default: 'MapView', Circle: 'Circle', Marker: 'Marker' },
    './LocationScreen': { getDeviceCenter: async () => { gpsCalls++; if (fail) throw new Error('Permission denied'); return { latitude: 42, longitude: -81, name: 'GPS' }; } },
    '../components/LocationSearch': { LocationSearch: 'LocationSearch' },
    '../lib/api': { activityFilters: [], nearbyUrl: (...args) => { queries.push(args); return '/nearby'; }, api: async () => [] },
  });
  await h.find('Btn', p => p.label === 'Use My Current Location').onPress(); await tick();
  assert.equal(props.center.name, 'GPS'); assert.deepEqual(Array.from(queries.at(-1)), [42, -81, 5, 'Food', 'coffee', 'upcoming']);
  h.find('LocationSearch').onSelect(place);
  await h.find('Btn', p => p.label === 'Use My Current Location').onPress();
  assert.equal(gpsCalls, 2); fail = true;
  await h.find('Btn', p => p.label === 'Use My Current Location').onPress();
  assert.equal(props.center.name, 'GPS'); assert.match(h.find('ErrorText', p => !!p.message).message, /denied/);
  assert.equal(h.find('MapView').initialRegion.latitude, 42);
});

test('GPS results after leaving Map cannot overwrite a later discovery selection', async () => {
  let finish, changes = 0;
  const h = harness(mapFile, 'MapScreen', { center: place, radius: 10, category: 'All', time: 'now', search: '', onCenterChange() { changes++; } }, {
    'react-native-maps': { __esModule: true, default: 'MapView', Circle: 'Circle', Marker: 'Marker' },
    './LocationScreen': { getDeviceCenter: () => new Promise(resolve => { finish = resolve; }) },
    '../components/LocationSearch': { LocationSearch: 'LocationSearch' },
    '../lib/api': { activityFilters: [], nearbyUrl: () => '/nearby', api: async () => [] },
  });
  const pending = h.find('Btn', p => p.label === 'Use My Current Location').onPress();
  h.unmount(); finish(place); await pending; assert.equal(changes, 0);
});

test('Map and Nearby retain shared radius and filters while Create gets no discovery mutation callback', () => {
  const imports = { 'expo-status-bar': {}, '@expo/vector-icons': {}, './src/lib/supabase': {}, './src/lib/api': {}, './src/theme/theme': { C: {} }, 'react-native-safe-area-context': {} };
  for (const name of ['Auth', 'Location', 'Feed', 'Map', 'PostDetail', 'CreatePost', 'EditPost', 'Activity', 'Profile']) imports[`./src/screens/${name}Screen`] = { [`${name}Screen`]: `${name}Screen` };
  const h = harness('apps/mobile/App.tsx', 'SignedIn', {}, imports, clock(), '\nexport { SignedIn };');
  h.find('LocationScreen').onSelected(place);
  const feed = h.find('FeedScreen'); feed.onRadiusChange(25); feed.onCategoryChange('Food'); feed.onTimeChange('upcoming'); feed.onSearchChange('coffee'); feed.onMap();
  const map = h.find('MapScreen'); assert.equal(map.radius, 25); assert.equal(map.category, 'Food'); assert.equal(map.time, 'upcoming');
  map.onCenterChange({ ...place, name: 'Other area' }); map.onBack();
  assert.equal(h.find('FeedScreen').center.name, 'Other area'); assert.equal(h.find('FeedScreen').radius, 25);
  h.find('Pressable', p => p.key === 'create').onPress();
  const create = h.find('CreatePostScreen'); assert.equal(create.center.name, 'Other area'); assert.equal(create.onCenterChange, undefined);
});

test('Create selects and confirms autocomplete coordinates without a map tap or changing the discovery center', () => {
  const discovery = { latitude: 41, longitude: -80, name: 'Discovery area' };
  const h = harness('apps/mobile/src/screens/CreatePostScreen.tsx', 'CreatePostScreen', { center: discovery, onPosted() {} }, {
    expo: { uuid: { v4: () => 'request' } }, 'expo-image-picker': {}, '@react-native-community/datetimepicker': {},
    'react-native-maps': { __esModule: true, default: 'MapView', Marker: 'Marker' },
    './LocationScreen': {}, '../lib/api': {},
    '../components/LocationSearch': { LocationSearch: 'LocationSearch', LocationCredits: 'LocationCredits' },
  });
  h.find('Btn', p => p.label === 'Choose a place').onPress();
  h.find('LocationSearch').onSelect({ ...place, latitude: 40.71284, longitude: -74.00602 });
  assert.equal(h.find('LocationSearch').selected.latitude, 40.713);
  const confirm = h.find('Btn', p => p.label === 'Use this location');
  assert.equal(confirm.disabled, false); confirm.onPress();
  assert.equal(h.find('Btn', p => p.label === 'Change location').disabled, false);
  assert.equal(discovery.latitude, 41); assert.equal(discovery.name, 'Discovery area');
});
