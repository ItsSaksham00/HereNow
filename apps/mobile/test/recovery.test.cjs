// Tests screen state and real handlers with native controls substituted, not live devices.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Reproduces hook updates and cleanup while exposing the screen's native event props.
function screen(file, name, props, overrides = {}, append = '') {
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
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8') + append, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, console, Date, Set, Error, URL, URLSearchParams, require(key) { assert.ok(key in imports, `Unexpected import ${key}`); return imports[key]; } });
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
const recoveryFile = 'apps/mobile/src/lib/recovery.ts';
const email = 'member@example.test';

// Uses a test-only page address; production stays unset until HTTPS hosting is ready.
function recovery(redirect = 'https://reset.example.test/', openURL = async () => {}) {
  const calls = [];
  return { ...screen(recoveryFile, 'unused', {}, {
    'react-native': { Linking: { openURL: async url => { calls.push(url); await openURL(url); } } },
    './recovery-config': { passwordResetUrl: redirect },
  }).exports, calls };
}

test('valid email opens the HTTPS browser page with prefill in the fragment, never a token', async () => {
  const r = recovery();
  for (const invalid of ['', 'name', 'a@', '@example.test', 'a b@example.test', 'a@example']) await assert.rejects(r.openRecoveryPage(invalid), /valid email/);
  assert.equal(r.calls.length, 0); await r.openRecoveryPage(` ${email} `);
  const url = new URL(r.calls[0]); assert.equal(url.protocol, 'https:'); assert.equal(url.search, '');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('email'), email);
});

test('unset or insecure configuration never launches a broken recovery page', async () => {
  for (const redirect of ['', 'http://reset.example.test', 'herenow://reset-password', 'https://user@reset.example.test', 'https://reset.example.test/#token', 'https://reset.example.test/?token=value']) {
    const r = recovery(redirect); await assert.rejects(r.openRecoveryPage(email), /not configured/); assert.equal(r.calls.length, 0);
  }
});

test('Forgot Password pre-fills email, opens once per pending action, and does not claim an email was sent', async () => {
  let requests = 0, finish;
  const h = screen('apps/mobile/src/screens/ForgotPasswordScreen.tsx', 'ForgotPasswordScreen', { email, onBack() {} }, {
    '../lib/recovery': { openRecoveryPage: () => { requests++; return new Promise(resolve => { finish = resolve; }); } },
  });
  assert.equal(h.find('Field', p => p.label === 'Email').value, email);
  const open = h.find('Btn', p => p.label === 'Continue in browser').onPress; open(); open();
  assert.equal(requests, 1); assert.equal(h.find('Btn', p => p.label === 'Opening…').disabled, true);
  finish(); await tick(); assert.match(h.text(), /Continue on the webpage to send your reset link/);
  assert.match(h.text(), /Email limits still apply/); assert.throws(() => h.find('Field', p => p.label === 'Recovery code'));
});

test('browser failures stay retryable and Login remains available', async () => {
  let back = 0;
  const h = screen('apps/mobile/src/screens/ForgotPasswordScreen.tsx', 'ForgotPasswordScreen', { email, onBack() { back++; } }, {
    '../lib/recovery': { openRecoveryPage: async () => { throw new Error('Could not open your browser. Please try again.'); } },
  });
  await h.find('Btn', p => p.label === 'Continue in browser').onPress(); assert.match(h.find('ErrorText').message, /Could not open/);
  h.find('Btn', p => p.label === 'Return to Login').onPress(); assert.equal(back, 1);
});
test('login and registration still call the existing Supabase APIs and Forgot Password receives the typed email', async () => {
  const calls = [];
  const user = { email };
  const h = screen('apps/mobile/src/screens/AuthScreen.tsx', 'AuthScreen', { initialMode: 'login', onRecovery() {} }, {
    '../lib/supabase': { supabase: { auth: {
      signInWithPassword: async body => { calls.push(['login', body]); return { error: null }; },
      signUp: async body => { calls.push(['signup', body]); return { data: { session: {} }, error: null }; },
    } } }, './ForgotPasswordScreen': { ForgotPasswordScreen: 'ForgotPasswordScreen' },
  });
  h.find('Field', p => p.label === 'Email').onChangeText(' member@example.test ');
  h.find('Field', p => p.label === 'Password').onChangeText('existing-password');
  await h.find('Btn', p => p.label === 'Log in').onPress(); assert.equal(calls[0][1].email, user.email);
  h.find('Btn', p => p.label === 'Forgot Password?').onPress(); assert.equal(h.find('ForgotPasswordScreen').email.trim(), user.email);
  h.find('ForgotPasswordScreen').onBack(); h.find('Btn', p => p.label === 'New here? Create an account').onPress();
  h.find('Field', p => p.label === 'Display name').onChangeText(' Alex ');
  await h.find('Btn', p => p.label === 'Create account').onPress(); assert.equal(calls[1][0], 'signup'); assert.equal(calls[1][1].options.data.display_name, 'Alex');
});
