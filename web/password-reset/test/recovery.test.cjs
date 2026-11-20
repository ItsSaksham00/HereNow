const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const user = { id: 'owner', email: 'member@example.test' };
const claims = { sub: user.id, session_id: 'recovery-session', exp: Math.floor(Date.now() / 1000) + 3600, amr: [{ method: 'recovery' }] };
const query = '?code=test-code';

// Supplies explicit server-verified claims and auth responses without real accounts or tokens.
function recovery(overrides = {}) {
  const calls = [];
  const auth = {
    getClaims: async () => ({ data: { claims }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    exchangeCodeForSession: async (code, options) => { calls.push(['exchange', code, options]); return { data: { session: { access_token: 'test-access', user }, user }, error: null }; },
    resetPasswordForEmail: async (email, options) => { calls.push(['email', email, options]); return { error: null }; },
    updateUser: async body => { calls.push(['password', body]); return { data: { user }, error: null }; },
    signOut: async options => { calls.push(['signout', options]); return { error: null }; },
    ...overrides,
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/recovery.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, URLSearchParams, Date, Error });
  return { service: new exports.PasswordRecovery(auth), calls, Recovery: exports.PasswordRecovery };
}

test('a default PKCE recovery redirect validates its code, signed claims, and user identity', async () => {
  const r = recovery(); assert.equal(await r.service.open(query, ''), user.email);
  assert.equal(r.calls[0][1], 'test-code');
  await r.service.update('new-password', 'new-password');
  assert.equal(r.calls.at(-1)[0], 'password');
  await assert.rejects(r.service.update('another-password', 'another-password'), /invalid, expired/);
});

test('ordinary signed-in sessions retain strict rejection with a recovery-purpose diagnostic', async () => {
  for (const amr of [[{ method: 'password' }], [{ method: 'otp' }], [], undefined]) {
    const r = recovery({ getClaims: async () => ({ data: { claims: { ...claims, amr } }, error: null }) });
    await assert.rejects(r.service.open(query, ''), error => error.category === 'not_recovery' && error.stage === 'claims');
    assert.equal(r.calls.some(call => call[0] === 'password'), false);
    await assert.rejects(r.service.update('new-password', 'new-password'));
  }
});

test('claims, expiry, and identity failures carry their actual failing stage', async () => {
  const cases = [
    [{ getClaims: async () => ({ data: null, error: { code: 'bad_jwt' } }) }, 'auth_failure', 'claims'],
    [{ getClaims: async () => ({ data: { claims: { ...claims, exp: 1 } }, error: null }) }, 'expired_link', 'claims'],
    [{ getClaims: async () => ({ data: { claims: { ...claims, session_id: '' } }, error: null }) }, 'auth_failure', 'claims'],
    [{ getUser: async () => ({ data: { user: { ...user, id: 'other' } }, error: null }) }, 'auth_failure', 'identity'],
  ];
  for (const [overrides, category, stage] of cases) {
    const r = recovery(overrides);
    await assert.rejects(r.service.open(query, ''), error => error.category === category && error.stage === stage);
    assert.equal(r.calls.some(call => call[0] === 'password'), false);
  }
});

test('callback errors are recognized in both queries and fragments without echoing provider descriptions', async () => {
  const cases = [
    ['', '', 'missing_callback'],
    ['?error=access_denied&error_code=otp_expired&error_description=private-detail', '', 'expired_link'],
    ['', '#error=access_denied&error_code=otp_expired&error_description=private-detail', 'expired_link'],
    ['?error=server_error&error_description=private-detail', '', 'auth_failure'],
    ['?type=signup', '', 'missing_callback'],
    [query + '&code=duplicate', '', 'invalid_callback'],
    ['?access_token=private-detail', '', 'missing_callback'],
    ['', '#access_token=private-detail&type=recovery', 'unsupported_flow'],
  ];
  for (const [search, hash, category] of cases) {
    const r = recovery();
    await assert.rejects(r.service.open(search, hash), error => error.category === category && error.stage === 'callback' && !error.message.includes('private-detail'));
    assert.equal(r.calls.some(call => call[0] === 'exchange' || call[0] === 'signout'), false);
  }
});

test('missing verifier, changed request, expired code, auth rejection, and network failure are distinct', async () => {
  for (const [failure, category] of [
    [{ code: 'pkce_code_verifier_not_found' }, 'browser_mismatch'],
    [{ name: 'AuthPKCECodeVerifierMissingError' }, 'browser_mismatch'],
    [{ code: 'bad_code_verifier' }, 'browser_mismatch'],
    [{ code: 'flow_state_expired' }, 'expired_link'],
    [{ code: 'flow_state_not_found' }, 'expired_link'],
    [{ code: 'bad_jwt', status: 401 }, 'auth_failure'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'network_failure'],
  ]) {
    const r = recovery({ exchangeCodeForSession: async () => ({ data: {}, error: { ...failure, message: 'private-detail' } }) });
    await assert.rejects(r.service.open(query, ''), error => error.category === category && error.stage === 'exchange' && !error.message.includes('private-detail'));
    assert.equal(r.calls.some(call => call[0] === 'signout'), false);
    await assert.rejects(r.service.update('new-password', 'new-password'));
  }
});

test('password mismatch and short passwords never update; policy and network failures allow explicit retry', async () => {
  let attempts = 0;
  const r = recovery({ updateUser: async () => {
    attempts++; if (attempts === 1) return { error: { code: 'weak_password' } };
    if (attempts === 2) return { error: { status: 429 } };
    return { data: { user }, error: null };
  } });
  await r.service.open(query, '');
  await assert.rejects(r.service.update('short', 'short'), /at least 6/);
  await assert.rejects(r.service.update('new-password', 'different'), /do not match/); assert.equal(attempts, 0);
  await assert.rejects(r.service.update('new-password', 'new-password'), /stronger, different/);
  await assert.rejects(r.service.update('new-password', 'new-password'), /wait and try again/);
  await r.service.update('new-password', 'new-password'); assert.equal(attempts, 3);
});

test('changed user, session, or authentication method after opening the form blocks the update', async () => {
  for (const change of [{ sub: 'other' }, { session_id: 'other' }, { amr: ['password'] }, { exp: 1 }]) {
    let current = claims;
    const r = recovery({ getClaims: async () => ({ data: { claims: current }, error: null }) });
    await r.service.open(query, ''); current = { ...claims, ...change };
    await assert.rejects(r.service.update('new-password', 'new-password'));
    assert.equal(r.calls.some(call => call[0] === 'password'), false);
  }
});

test('pending updates are not duplicated and sign-out retry never resubmits the password', async () => {
  let complete, writes = 0, closes = 0;
  const r = recovery({ updateUser: () => { writes++; return new Promise(resolve => { complete = resolve; }); },
    signOut: async () => ({ error: ++closes === 1 ? {} : null }),
  });
  await r.service.open(query, '');
  const pending = r.service.update('new-password', 'new-password'); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(r.service.update('new-password', 'new-password'), /Please wait/); assert.equal(writes, 1);
  complete({ error: null }); await pending;
  await assert.rejects(r.service.close(), /sign-out failed/); await r.service.close(); assert.equal(writes, 1);
});

// Runs the real browser event handlers with a tiny DOM and mocked Supabase transport.
function browser(search = query, serverClaims = claims, hash = '', scenario = {}) {
  const calls = [], nodes = {};
  for (const id of ['status', 'error', 'request-form', 'email', 'send', 'reset-form', 'password', 'confirmation', 'submit', 'show-passwords', 'finish']) {
    nodes[id] = { hidden: ['request-form', 'reset-form', 'finish'].includes(id), disabled: false, textContent: '', value: '', type: 'password', events: {},
      addEventListener(event, handler) { this.events[event] = handler; } };
  }
  const auth = {
    getClaims: async () => ({ data: { claims: serverClaims }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    exchangeCodeForSession: async () => scenario.exchangeError ? { data: {}, error: scenario.exchangeError } : ({ data: { session: { access_token: 'test-access', user }, user }, error: null }),
    resetPasswordForEmail: async () => { calls.push('email'); return { error: null }; },
    updateUser: async () => { calls.push('update'); return { data: { user }, error: null }; },
    signOut: async () => { calls.push('signout'); return { error: null }; },
  };
  const recoveryExports = {};
  const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/recovery.ts'), 'utf8'), { compilerOptions }).outputText,
    { exports: recoveryExports, URLSearchParams, Date, Error });
  const location = { protocol: 'https:', origin: 'https://reset.example.test', pathname: '/', search, hash };
  const imports = {
    './vendor.js': { createClient(_url, _key, options) {
      assert.equal(options.auth.persistSession, true); assert.equal(options.auth.flowType, 'pkce'); assert.equal(options.auth.detectSessionInUrl, false); assert.equal(options.auth.autoRefreshToken, false);
      return { auth };
    } }, './recovery.js': recoveryExports, './storage.js': { recoveryStorage: () => { if (scenario.storageBlocked) throw Object.assign(new Error('private-detail'), { name: 'RecoveryStorageError' }); return {}; } },
  };
  const page = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/page.ts'), 'utf8'), { compilerOptions }).outputText;
  vm.runInNewContext(page, {
    exports: {}, URL, URLSearchParams, Error,
    window: { location, crypto: { subtle: {}, getRandomValues() {} }, localStorage: {}, history: { replaceState(_state, _title, target) { calls.push('strip'); assert.equal(target, '/'); location.hash = ''; location.search = ''; } } },
    document: { querySelector: selector => nodes[selector.slice(1)] },
    fetch: async (url, options) => { calls.push('config'); if (scenario.offline) throw new TypeError('private-detail'); assert.equal(url, './config.json'); assert.equal(options.referrerPolicy, 'no-referrer'); return { ok: true, json: async () => ({ supabaseUrl: scenario.badConfig ? '' : 'https://project.example.test', supabasePublishableKey: 'sb_publishable_test' }) }; },
    require: name => { assert.ok(name in imports); return imports[name]; },
  });
  return { calls, nodes, location };
}

test('the actual page clears URL credentials before config requests and completes without forwarding tokens', async () => {
  const h = browser(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls[0], 'strip'); assert.equal(h.calls[1], 'config'); assert.equal(h.location.hash, '');
  assert.equal(h.nodes['reset-form'].hidden, false); assert.ok(h.nodes.status.textContent.includes(user.email));
  h.nodes.password.value = h.nodes.confirmation.value = 'new-password';
  const event = { preventDefault() {} };
  h.nodes['reset-form'].events.submit(event); h.nodes['reset-form'].events.submit(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(value => value === 'update').length, 1);
  assert.equal(h.nodes.password.value, ''); assert.equal(h.nodes['reset-form'].hidden, true);
  h.nodes.finish.events.click(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.nodes.status.textContent.includes('return to HereNow'));
  assert.equal(h.nodes.finish.hidden, true);
});

test('a browser with a normal session and forged recovery type never displays the password form', async () => {
  const h = browser(query, { ...claims, amr: ['password'] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.nodes['reset-form'].hidden, true);
  assert.ok(h.nodes.error.textContent.includes('claims/not_recovery'));
  assert.equal(h.nodes.error.textContent.includes('test-access'), false);
  assert.equal(h.calls.includes('update'), false);
});

test('browser email requests use resetPasswordForEmail, stay neutral, and handle rate limits without retry', async () => {
  let calls = 0;
  const r = recovery({ resetPasswordForEmail: async (_email, options) => {
    assert.equal(options.redirectTo, 'https://reset.example.test/'); calls++;
    return { error: calls === 1 ? { code: 'user_not_found' } : { status: 429 } };
  } });
  await assert.rejects(r.service.request('invalid', 'https://reset.example.test/'), /valid email/);
  assert.equal(calls, 0);
  await r.service.request(user.email, 'https://reset.example.test/');
  await assert.rejects(r.service.request(user.email, 'https://reset.example.test/'), /wait and try again later/); assert.equal(calls, 2);
});

test('first browser visit prefills email but sends nothing until an explicit click', async () => {
  const h = browser('', claims, '#email=member%40example.test'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.nodes['request-form'].hidden, false); assert.equal(h.nodes.email.value, user.email);
  assert.equal(h.calls.includes('email'), false);
  h.nodes['request-form'].events.submit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(value => value === 'email').length, 1);
  assert.ok(h.nodes.status.textContent.includes('If an account exists'));
});

// Runs the actual installed SDK across two clients to verify the browser-storage handshake.
test('PKCE verifiers survive a new browser page, while access and refresh tokens remain in memory', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/storage.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, Map, JSON });
  const saved = new Map();
  const local = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  let redirect, challenge, verifier;
  const options = { auth: { storageKey: 'herenow-reset', storage: exports.recoveryStorage(local), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce' },
    global: { fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      if (String(url).includes('/recover')) {
        redirect = new URL(url).searchParams.get('redirect_to'); challenge = body.code_challenge;
        assert.equal(body.code_challenge_method, 's256'); return new Response('{}', { status: 200 });
      }
      assert.ok(String(url).includes('grant_type=pkce')); verifier = body.code_verifier;
      return new Response(JSON.stringify({ access_token: 'test-access-only', refresh_token: 'test-refresh-only', expires_in: 3600, token_type: 'bearer', user }), { status: 200 });
    } },
  };
  const first = createClient('https://project.example.test', 'sb_publishable_test', options);
  assert.equal((await first.auth.resetPasswordForEmail(user.email, { redirectTo: 'https://reset.example.test/' })).error, null);
  assert.equal(redirect, 'https://reset.example.test/');
  const beforeInvalidCallback = JSON.stringify([...saved]);
  const callback = new (recovery().Recovery)(first.auth);
  await assert.rejects(callback.open('?error_code=otp_expired', ''), error => error.category === 'expired_link');
  assert.equal(JSON.stringify([...saved]), beforeInvalidCallback, 'An old error callback must not delete the newer verifier');
  const otherProfile = { getItem: () => null, setItem() {}, removeItem() {} };
  const differentBrowser = createClient('https://project.example.test', 'sb_publishable_test', { ...options, auth: { ...options.auth, storage: otherProfile } });
  const mismatch = new (recovery().Recovery)(differentBrowser.auth);
  await assert.rejects(mismatch.open(query, ''), error => error.category === 'browser_mismatch' && error.stage === 'exchange');
  assert.equal(JSON.stringify([...saved]), beforeInvalidCallback);
  differentBrowser.auth.stopAutoRefresh();
  const second = createClient('https://project.example.test', 'sb_publishable_test', { ...options, auth: { ...options.auth, storage: exports.recoveryStorage(local) } });
  assert.equal((await second.auth.exchangeCodeForSession('one-use-test-code')).error, null);
  const { createHash } = require('node:crypto');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge);
  assert.equal(JSON.stringify([...saved.values()]).includes('test-access-only'), false);
  assert.equal(JSON.stringify([...saved.values()]).includes('test-refresh-only'), false);
  first.auth.stopAutoRefresh(); second.auth.stopAutoRefresh();
});

test('the deployment artifact is self-contained and permits config fetch without unrelated network origins', () => {
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'herenow-reset-build-'));
  try {
    execFileSync(process.execPath, [path.join(__dirname, '../build.cjs'), output], { stdio: 'pipe' });
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    const headers = fs.readFileSync(path.join(output, '_headers'), 'utf8');
    assert.match(html, /connect-src 'self'/); assert.match(html, /script-src 'self'/);
    assert.match(headers, /Referrer-Policy: no-referrer/); assert.match(headers, /frame-ancestors 'none'/);
    assert.match(fs.readFileSync(path.join(output, 'vendor.js'), 'utf8'), /export const createClient/);
    assert.ok(fs.existsSync(path.join(output, 'storage.js'))); assert.ok(fs.existsSync(path.join(output, 'SUPABASE-LICENSE.txt')));
    assert.equal(fs.readdirSync(output).some(file => file.startsWith('.env')), false);
    assert.equal(html.includes('__CSP__'), false);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('browser diagnostics separate storage, configuration, network, and missing-verifier failures', async () => {
  for (const [scenario, diagnostic] of [
    [{ storageBlocked: true }, 'storage/storage_unavailable'],
    [{ badConfig: true }, 'configuration/configuration_failure'],
    [{ offline: true }, 'configuration/network_failure'],
    [{ exchangeError: { code: 'pkce_code_verifier_not_found', message: 'private-detail' } }, 'exchange/browser_mismatch'],
  ]) {
    const h = browser(query, claims, '', scenario); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.nodes['reset-form'].hidden, true);
    assert.ok(h.nodes.error.textContent.includes(diagnostic), diagnostic);
    assert.equal(h.nodes.error.textContent.includes('private-detail'), false);
    assert.equal(h.nodes.error.textContent.includes('test-code'), false);
  }
});

test('blocked browser storage is detected before requesting email or creating a verifier', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/storage.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, Map, JSON });
  const blocked = { setItem() { throw new Error('private browser details'); }, getItem() { return null; }, removeItem() {} };
  assert.throws(() => exports.recoveryStorage(blocked), error => error.name === 'RecoveryStorageError' && !error.message.includes('private browser details'));
});
