// Uses a disposable local PostgreSQL cluster, never Supabase or a configured database URL.
// Set HERENOW_PG_BIN to a PostgreSQL bin directory if it is not found below.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const candidates = [process.env.HERENOW_PG_BIN, '/Library/PostgreSQL/18/bin', '/opt/homebrew/opt/postgresql@18/bin', '/usr/lib/postgresql/18/bin'].filter(Boolean);
const bin = candidates.find(directory => fs.existsSync(path.join(directory, 'initdb')));
const options = { skip: !bin ? 'Local PostgreSQL binaries are needed for database/concurrency tests.' : false };
const root = path.resolve(__dirname, '../../..');
const id = number => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
let temporary, dataDirectory, environment;

// Runs SQL only against the private Unix socket of this test's temporary cluster.
async function sql(statement) {
  const { stdout } = await execute(path.join(bin, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement], { env: environment });
  return stdout.trim();
}

before(async () => {
  if (!bin) return;
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'herenow-social-'));
  dataDirectory = path.join(temporary, 'data');
  const socket = path.join(temporary, 'socket');
  fs.mkdirSync(socket);
  environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.startsWith('PG')) delete environment[key];
  Object.assign(environment, { PGHOST: socket, PGPORT: '55439', PGDATABASE: 'postgres', PGUSER: 'herenow_test', PGCONNECT_TIMEOUT: '5' });
  await execute(path.join(bin, 'initdb'), ['-D', dataDirectory, '-U', 'herenow_test', '-A', 'trust', '--no-locale', '-E', 'UTF8', '--no-sync'], { env: environment });
  await execute(path.join(bin, 'pg_ctl'), ['-D', dataDirectory, '-l', path.join(temporary, 'server.log'), '-o', `-h '' -k ${socket} -p 55439`, '-w', 'start'], { env: environment });

  // Minimal Supabase-owned schemas; all application tables/functions come from the real migrations.
  await sql(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  `);
  for (const migration of ['001_init.sql', '002_activity_posting.sql', '003_social_interactions.sql']) {
    await sql(fs.readFileSync(path.join(root, 'supabase', migration), 'utf8'));
  }
  await sql(`
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    insert into auth.users(id)
      select ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid from generate_series(1, 20) n;
    insert into public.profiles(id, display_name, push_enabled) values
      ('${id(1)}', 'Creator', false), ('${id(2)}', 'Alex', false), ('${id(3)}', 'Sam', false);
    insert into public.posts(id, creator_id, title, description, category, place_name, latitude, longitude, status, activity_at, published_at, expires_at)
      select ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
        '${id(1)}', 'Coffee on the patio', 'Join us', 'Food', 'Cafe', 41, -80,
        'PUBLISHED', now(), now(), now() + interval '2 hours'
      from generate_series(100, 160) n;
    update public.posts set expires_at = now() - interval '1 second' where id = '${id(120)}';
    update public.posts set status = 'READY' where id = '${id(121)}';
    update public.posts set status = 'FAILED' where id = '${id(122)}';
    update public.posts set status = 'EXPIRED' where id = '${id(123)}';
  `);
});

after(async () => {
  if (!temporary) return;
  try {
    if (fs.existsSync(path.join(dataDirectory, 'postmaster.pid'))) {
      await execute(path.join(bin, 'pg_ctl'), ['-D', dataDirectory, '-m', 'immediate', '-w', 'stop'], { env: environment });
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('empty summaries return zero and expose no interested-user identities', options, async () => {
  const rows = JSON.parse(await sql(`select json_agg(s) from public.post_interest_summary(array['${id(100)}','${id(101)}']::uuid[], '${id(2)}') s;`));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.interest_count, 0);
    assert.equal(row.interested, false);
    assert.deepEqual(Object.keys(row).sort(), ['interest_count', 'interested', 'post_id']);
  }
});

test('repeated interest calls persist one interest and one named notification with push disabled', options, async () => {
  const first = JSON.parse(await sql(`select public.express_interest('${id(2)}','${id(110)}');`));
  const again = JSON.parse(await sql(`select public.express_interest('${id(2)}','${id(110)}');`));
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(first.id, again.id);
  assert.deepEqual(Object.keys(again).sort(), ['created', 'id']);
  const notices = JSON.parse(await sql(`select json_agg(n) from public.notifications n where post_id = '${id(110)}';`));
  assert.equal(notices.length, 1);
  assert.equal(notices[0].recipient_id, id(1));
  assert.equal(notices[0].actor_id, id(2));
  assert.equal(notices[0].interest_id, first.id);
  assert.match(notices[0].message, /Alex.*Coffee on the patio/);
  assert.equal(notices[0].is_read, false);
  assert.equal(await sql(`select push_enabled from public.profiles where id = '${id(1)}';`), 'f');
  await sql(`update public.notifications set is_read = true where post_id = '${id(110)}' and recipient_id = '${id(1)}';`);
  await sql(`select public.express_interest('${id(2)}','${id(110)}');`);
  assert.equal(await sql(`select count(*) || ':' || bool_and(is_read) from public.notifications where post_id = '${id(110)}';`), '1:true');
});

test('concurrent submissions from one user commit exactly once', options, async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => sql(`select public.express_interest('${id(2)}','${id(111)}');`)));
  const results = responses.map(response => JSON.parse(response));
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(new Set(results.map(result => result.id)).size, 1);
  assert.equal(await sql(`select count(*) from public.interests where post_id = '${id(111)}';`), '1');
  assert.equal(await sql(`select count(*) from public.notifications where post_id = '${id(111)}';`), '1');
});

test('concurrent different users produce an accurate count and only the viewer’s state', options, async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => sql(`select public.express_interest('${id(index + 2)}','${id(112)}');`)));
  assert.ok(results.every(result => JSON.parse(result).created));
  for (const [viewer, interested] of [[2, true], [15, false]]) {
    const summary = JSON.parse(await sql(`select row_to_json(s) from public.post_interest_summary(array['${id(112)}']::uuid[], '${id(viewer)}') s;`));
    assert.equal(summary.interest_count, 8);
    assert.equal(summary.interested, interested);
  }
  assert.equal(await sql(`select count(*) from public.notifications where post_id = '${id(112)}';`), '8');
});

test('self-interest, null actors, and unavailable activities cannot change counts or notifications', options, async () => {
  await assert.rejects(sql(`select public.express_interest('${id(1)}','${id(124)}');`), /Cannot join your own activity/);
  await assert.rejects(sql(`select public.express_interest(null,'${id(124)}');`), /Sign in required/);
  for (const post of [120, 121, 122, 123, 999]) {
    await assert.rejects(sql(`select public.express_interest('${id(2)}','${id(post)}');`), /Activity unavailable/);
  }
  assert.equal(await sql(`select count(*) from public.interests where post_id in ('${id(120)}','${id(121)}','${id(122)}','${id(123)}','${id(124)}');`), '0');
  assert.equal(await sql(`select count(*) from public.notifications where post_id in ('${id(120)}','${id(121)}','${id(122)}','${id(123)}','${id(124)}');`), '0');
});

test('notification failure rolls back the interest in the same transaction', options, async () => {
  await sql(`
    create function public.reject_test_notification() returns trigger language plpgsql as $$
    begin
      if new.post_id = '${id(113)}' then raise exception 'test notification failure'; end if;
      return new;
    end $$;
    create trigger reject_test_notification before insert on public.notifications
      for each row execute function public.reject_test_notification();
  `);
  await assert.rejects(sql(`select public.express_interest('${id(2)}','${id(113)}');`), /test notification failure/);
  assert.equal(await sql(`select count(*) from public.interests where post_id = '${id(113)}';`), '0');
  assert.equal(await sql(`select count(*) from public.notifications where post_id = '${id(113)}';`), '0');
});

test('database uniqueness remains enforced and missing profiles use a readable notification fallback', options, async () => {
  await sql(`select public.express_interest('${id(4)}','${id(115)}');`);
  await assert.rejects(sql(`insert into public.interests(user_id,post_id) values ('${id(4)}','${id(115)}');`), /duplicate key/);
  assert.match(await sql(`select message from public.notifications where post_id = '${id(115)}';`), /HereNow member.*Coffee on the patio/);
});

test('batch counts remain exact above the usual PostgREST row limit', options, async () => {
  await sql(`
    insert into auth.users(id) select ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid from generate_series(1000, 2199) n;
    insert into public.interests(user_id,post_id)
      select id, '${id(116)}' from auth.users where id >= '${id(1000)}' and id <= '${id(2199)}';
  `);
  assert.equal(await sql(`select interest_count from public.post_interest_summary(array['${id(116)}']::uuid[], '${id(2)}');`), '1200');
});

test('only the backend role can execute the social functions', options, async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(sql(`set role ${role}; select public.express_interest('${id(2)}','${id(100)}');`), /permission denied/);
    await assert.rejects(sql(`set role ${role}; select * from public.post_interest_summary(array['${id(100)}']::uuid[], '${id(2)}');`), /permission denied/);
  }
  assert.equal(await sql(`set role service_role; select interest_count from public.post_interest_summary(array['${id(100)}']::uuid[], '${id(2)}');`), 'SET\n0');
});

test('concurrent comment retries persist one correctly associated comment with creation time', options, async () => {
  const replies = await Promise.all(Array.from({ length: 8 }, () => sql(`
    insert into public.comments(post_id,author_id,body,client_request_id)
    values ('${id(150)}','${id(2)}','See you there','same-comment')
    on conflict (author_id,client_request_id) do nothing returning id;
  `)));
  assert.equal(replies.filter(reply => reply.startsWith('00000000') || /^[0-9a-f-]{36}\n/.test(reply)).length, 1);
  const saved = JSON.parse(await sql(`select row_to_json(c) from public.comments c where post_id = '${id(150)}';`));
  assert.equal(saved.author_id, id(2));
  assert.equal(saved.body, 'See you there');
  assert.ok(saved.created_at);
  assert.equal(await sql(`select count(*) from public.comments where post_id = '${id(150)}';`), '1');
  await assert.rejects(sql(`insert into public.comments(post_id,author_id,body) values ('${id(150)}','${id(2)}','   ');`), /check constraint/);
  await assert.rejects(sql(`insert into public.comments(post_id,author_id,body) values ('${id(150)}','${id(2)}',repeat('x',501));`), /value too long/);
});
