# HereNow — mobile MVP starter


Instructions For Testing:

Run  npm.cmd install --save-dev jest ts-jest @types/jest in the root folder in either \apps\mobile or \apps\api depending which file you want to test. 




**Project:** HereNow — *See what’s happening around you. Right now.*

**Stack:** React Native + TypeScript (Expo SDK 58), NestJS + TypeScript, Supabase Auth, Supabase PostgreSQL, private Supabase Storage, OpenAI vision. Same Git repository with two applications.

**Source of truth:** `references/HereNow_SystemAndProgramDesign.pdf` is the newer architecture specification. `references/HereNow_Updated_Design.html` is the visual style reference. See `DECISIONS_AND_ROADMAP.md` for the differences between those files and the older project plan.

## Start from zero (Mac or Windows)

Requires **Node.js 22.13+**, npm, an [Expo Go](https://expo.dev/go) phone app, a Supabase project, and optionally an OpenAI API key for photo suggestions. Manual posting does not require an AI key.

1. Extract this ZIP to a folder named `HereNowStarter` and open the folder in VS Code.
2. Create a project at **https://supabase.com/dashboard**. In **SQL Editor**, paste and run `supabase/001_init.sql` once. This creates the app tables, nearby-query function, atomic interest action, and private photo bucket. Supabase Auth is managed automatically. Then run `supabase/002_activity_posting.sql` for activity times, filtered feeds, and duplicate-comment protection, followed by `supabase/003_social_interactions.sql` for interest summaries and named creator notifications. On an existing project, apply only the migrations you have not already applied, in numeric order. Apply this migration before starting the updated API; the app does not run migrations automatically.
3. Copy **`apps/api/.env.example` → `apps/api/.env`**. Enter the Supabase **Project URL** and the **secret/service-role key** from API Keys, and optionally `OPENAI_API_KEY` for AI autofill. Keep these secrets **only on the backend**. The sample values are not working credentials.
4. Copy **`apps/mobile/.env.example` → `apps/mobile/.env`**. Enter the same Supabase Project URL, the **publishable key** (NOT the secret key), and the API URL.
5. On a physical phone, `EXPO_PUBLIC_API_URL` must be your laptop's reachable LAN address, e.g. `http://192.168.1.40:3000/api`, **not `localhost`**. The laptop and phone should be on the same Wi-Fi, and the firewall must allow TCP 3000. Check the PC IP with `ipconfig` (Windows) or `ipconfig getifaddr en0` (Mac Wi-Fi).
6. From the project root, run:

```bash
npm install
cd apps/mobile
npx expo install --fix
cd ../..
```

The `expo install --fix` step aligns native package versions with the selected Expo SDK.

7. Open **terminal A** in the root:

```bash
npm run api
```

8. Open **terminal B** in the root:

```bash
npm run mobile
```

Scan the Expo QR with Expo Go, or launch a simulator. Register an account and sign in. If Supabase Auth has email confirmation enabled, first confirm your email. Test the nearby feed and location fallback. You can publish manually without an OpenAI key.

## Where everything is

```text
HereNowStarter/
├─ apps/
│  ├─ mobile/                  # Expo React Native mobile client
│  │  ├─ App.tsx               # Navigation and session gate
│  │  ├─ src/screens/          # Welcome/Login, Location, Feed, Map, Create, Details, Activity, Profile
│  │  ├─ src/components/       # Reusable mobile UI components
│  │  ├─ src/lib/              # Supabase client and backend fetch helper
│  │  └─ src/theme/            # HereNow colors
│  └─ api/                     # NestJS REST backend
│     ├─ src/auth/             # Supabase token verification guard
│     ├─ src/users/            # Profile creation/updates
│     ├─ src/posts/            # Feed, image upload, AI analysis, publish
│     ├─ src/interests/        # Atomic Let's Go action
│     ├─ src/comments/         # Public comments
│     └─ src/notifications/    # In-app inbox
├─ supabase/001_init.sql       # Database schema, functions, and private bucket
├─ references/                 # Your original UI, plan, and architecture documents
└─ DECISIONS_AND_ROADMAP.md    # Delivered vs deferred
```

## Current implemented flow

1. **Signup / login:** Supabase Auth registers and signs in; backend verifies bearer tokens with Auth service.
2. **Location:** after sign-in, choose device coordinates or a manual sample area. Change the center by tapping on the map.
3. **Nearby:** backend SQL selects unexpired, published activities in a radius, nearest first. Search, category, and activity-time filters run in SQL before pagination. Now shows started activities, Upcoming shows future activities, and All times includes both.
4. **Create:** phone camera or gallery → editable title, description, category, place, date/time, and optional labels → confirm the location using the selected area, map, or approximate device coordinates → publish. Device location permission is optional. **Fill details with AI** suggests only empty fields and never changes location or time. An AI failure does not block manual publishing. Timing defaults to Now; Later opens the native date/time picker. Times use the device’s timezone and are sent as ISO timestamps. Current activities get their lifetime from publication; future activities expire after their scheduled start plus the configured lifetime.
5. **Explore:** activity details and map markers share the same backend records.
6. **Let’s Go:** one interest per user and post, never on own or expired posts. SQL saves interest + creator's in-app alert together; repeat taps do not duplicate records. Feed and details responses include the unique-user interest count and the current viewer's interest state. New notifications include the interested member's display name and the activity title.
7. **Conversation:** authenticated public comments on published, unexpired posts, with author names, timestamps, exact counts, newest-first pagination, and retry-safe submission IDs.
8. **Activity and profile:** inbox with read flags; own posts, failed AI retry, deletion, and sign-out.

## REST endpoints (all require `Authorization: Bearer <Supabase access token>`)

| Method | Endpoint | Role |
|---|---|---|
| POST | `/api/users/me` | Ensure profile exists |
| GET / PATCH | `/api/users/me` | Read / update profile |
| GET | `/api/posts/nearby?latitude=...&longitude=...&radius=10` | Nearby feed and markers |
| GET | `/api/posts/mine` | Own posts |
| GET | `/api/posts/:id` | Post detail |
| POST (multipart) | `/api/posts` | Upload photo and publish manual details |
| POST (multipart) | `/api/posts/suggest` | Optional photo-only AI suggestions; no post is created |
| POST | `/api/posts/:id/analyze` | Retry failed AI analysis |
| POST | `/api/posts/:id/publish` | Confirm and publish ready draft |
| DELETE | `/api/posts/:id` | Delete own post |
| POST | `/api/interests/:postId` | Let's Go |
| GET | `/api/notifications` | Activity inbox |
| PATCH | `/api/notifications/:id/read` | Mark read |
| GET / POST | `/api/comments/:postId` | Public comments |

## Posting API fields and checks

`POST /api/posts` accepts multipart fields: `photo`, `title` (1–100 characters), `description` (1–1000), `category` (Food, Sports, Music, Outdoors, Social, Other), `placeName` (1–150), `latitude`, `longitude`, and `activityAt` (ISO date/time including a timezone). Optional `requestId` accepts a UUID v4 and reuses the post ID across upload retries; ownership is checked before resuming or returning an existing post. No additional database column is needed. Optional `labels[]` accepts up to five labels of 30 characters each. JPEG, PNG, and WebP photos are limited to 6 MB. Creation time is recorded by PostgreSQL. The response is the published post; clients do not need to call AI or publish a second time.

`POST /api/posts/suggest` accepts only the photo and returns `{ title, description, category, labels }`. Suggestions are not saved. The existing analyze/publish routes remain available for older drafts; older drafts without an activity time start at publication.

`GET /api/posts/nearby` also accepts `time=now|upcoming|all`, `category`, and `search`. Existing radius and coordinate parameters still apply. The filtered SQL function remains executable only by the service role.

`GET /api/comments/:postId?includeTotal=true&offset=0` returns `{ comments, total }`, up to 100 comments per page, newest first. Omitting `includeTotal` keeps the existing array response. Comment POST bodies may include a `clientRequestId` (up to 80 letters, numbers, or hyphens). Reuse it when retrying the same comment; the database prevents duplicate inserts for that author. Legacy clients without this field continue working.

Run from the repository root:

```bash
npm run typecheck --workspace=apps/api
npm run typecheck --workspace=apps/mobile
npm run build:api
node --test apps/api/test/posting.test.cjs apps/api/test/social-api.test.cjs
node --test apps/mobile/test/*.test.cjs
```

The tests use mocked database/storage calls and do not contact Supabase or AI. After applying the SQL migration, check the real upload, filters, comment counts, and retry behavior on a device. No migration is executed by these tests.

## Phase 4 social interactions

Apply `supabase/003_social_interactions.sql` manually in the Supabase SQL Editor after `002_activity_posting.sql`, before restarting the updated API. No migration is run against Supabase by the app or the test commands. This migration adds a private aggregate function and replaces the existing interest function; it does not add tables or change existing rows or uniqueness constraints. Existing notification messages and read flags are preserved.

Post responses now include `interestCount` alongside the existing `interested` boolean. The backend calls `post_interest_summary` once for the entire page of post IDs. PostgreSQL counts distinct users in the existing interests table and returns only the count and the current viewer's state per post. It does not return interested-user identities, and the function is executable only by the service role. Aggregation in SQL avoids per-post count requests and PostgREST row-limit undercounts.

Details show **Let’s Go · N**, then **Interested ✓ · N** after reloading the server response. Feed cards use a compact count in their existing footer. Creators see their count without a join button. Duplicate requests retain the existing `{ id, created }` response and cannot increase the count or create another notification. No optimistic counter increment is used. Older refresh responses cannot replace newer interest state.

The database records interest and the named creator notification in one transaction. It rejects self-interest, unpublished activities, and expired activities. A missing profile name uses “HereNow member.” In-app alerts are persisted regardless of push preference; device push delivery remains unimplemented. No new push service is introduced.

Comments retain their existing endpoints, author names, timestamps, exact totals, pagination, and retry IDs. Details and Activity support pull-to-refresh as well as their existing refresh actions. Tab/detail navigation remounts the relevant screen and fetches current data. Opening a notification saves its read flag; failures remain visible and retryable. No polling or real-time subscriptions are added.

For real database/concurrency tests, install local PostgreSQL separately and run:

```bash
node --test apps/api/test/social-postgres.test.cjs
```

The test discovers PostgreSQL 18 in common local locations, or accepts its bin directory through `HERENOW_PG_BIN`. It creates and removes a disposable cluster with a private Unix socket, bootstraps the migrations only in that test cluster, and ignores database connection variables. It never connects to the hosted project. If local binaries are absent, these tests explicitly skip. They cover parallel same-user and different-user submissions, exact large counts, unique constraints, role permissions, named notifications, rollback on notification failure, and concurrent comment retries. API tests mock Supabase; screen tests substitute native controls and do not validate physical-device layouts.

### Phase 4 live-device checklist

- Apply migration 003 manually, restart the API, and use two or three accounts on iPhone/Android.
- Account A publishes an activity. B checks the feed count, opens it, and taps Let’s Go. Confirm the button reads Interested ✓ · 1 and stays at 1 after reopening, refreshing, and repeated taps. C joining should make the total 2 across both screens after refresh. No interested-user list should be available.
- A sees the same count on their activity and has no Let’s Go button. A refreshes Activity and sees B/C's display names and the activity title. Each alert opens the correct post; read state survives leaving and reopening the inbox. Repeat with A's push preference disabled.
- Add comments from B and C. Check author names, times, exact count, refresh/reopen persistence, and Load more when enough comments exist. Interrupt a comment request and retry the unchanged draft; only one copy should be saved.
- Interrupt an interest request after tapping, reconnect, and retry or refresh. Confirm exactly one interest and one creator notification. Expired activities and drafts must not accept new interests; unpublished posts must remain private.

## Mobile upload and location behavior

Photo uploads use `File` from `expo-file-system` and `expo/fetch`. Expo SDK 58's multipart encoder rejects the old React Native `{ uri, name, type }` object. The app sends the real file as `photo`, keeps the bearer token, and lets Expo generate the multipart boundary. A failed publish keeps the submitted form and request ID for retry, so a lost response can be recovered without creating another post. Validation errors allow correcting the form.

The native date/time picker and file-system module are SDK-compatible dependencies. Restart Metro after updating dependencies (`cd apps/mobile` then `npx expo start --clear`). Expo Go must match SDK 58. If you use a custom development build, rebuild it to include the native date/time picker.

All screens share a root safe-area wrapper; shared layouts do not add another safe area. Create defaults to Now, keeps optional AI and labels compact, and places Publish below the scrollable form. Map has a bounded rounded viewport and a Search radius menu. Radius is shared with Nearby, including when returning with Back.

Typed place search now uses a shared 350 ms autocomplete dropdown backed by an authenticated NestJS endpoint, `/api/locations/autocomplete?q=...`. It does not request GPS permission. Suggestions select real provider coordinates directly on Map and Create; Create retains its explicit location confirmation and approximate public coordinates. Map and Nearby share center, radius, category, timing, and text filters. Create keeps its activity location separate.

**Configuration boundary:** Live autocomplete is unavailable until you create a Geoapify account/project, accept its terms, and configure `GEOAPIFY_API_KEY` in the backend runtime yourself. Never use an `EXPO_PUBLIC_` key. No credentials or `.env` files were changed. Missing configuration returns a friendly error; GPS and map pins remain available. Provider responses have only been tested with mocks, not a real key.

Geoapify was selected because its autocomplete returns coordinates in one request, works independently of the native map provider, and supports addresses, cities, neighborhoods, and named places where its data has coverage. Its [free plan](https://www.geoapify.com/pricing/) currently offers 3,000 credits/day and up to 5 requests/second without a credit card; verify current quotas before deployment. See the [autocomplete API](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/) and [terms](https://www.geoapify.com/terms-and-conditions/). Free usage requires Geoapify and data-source attribution: the UI retains Geoapify/OpenStreetMap links in search and activity details. Confirm any additional source-specific attribution requirements before enabling live traffic. Public Nominatim is not a fallback because its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) prohibits client-side autocomplete.

The backend keeps the key private, validates query length (3–120 characters), limits results to five, times out after five seconds, sanitizes provider failures, and permits at most four requests/second globally and thirty/user/minute per server process. These limits are for a student demonstration; multiple server instances do not share counters. Configure provider-side quotas/key restrictions and monitor credits before public deployment. Client cancellation and version checks discard stale suggestions.

Map’s **Use My Current Location** checks existing permission, explains a new permission request, checks Location Services, and waits at most twenty seconds for GPS. A failed or slow reverse lookup uses a fallback label without discarding valid coordinates. Failure preserves the selected area and filters. Leaving Map ignores late GPS results. Only the stable `expo-location` entry point is used.

If Expo Go reports `Cannot find native module 'LocationModuleNext'`, make sure it is loading the updated code. The app uses the stable location entry point; it does not need that beta native module. Update Expo Go to a version compatible with SDK 58, fully close it on the phone, stop Metro, then restart from `apps/mobile` with `npx expo start --clear`. Scan the new QR code rather than reopening an old recent project. A JavaScript reload cannot install a missing native module into an older Expo Go binary. On both platforms, typed search must work without requesting foreground location permission once the backend key is configured; manual map selection must remain available. On both, test My location, pin confirmation, map markers, and radius changes returning to Nearby. Bundle exports and mocked tests do not replace these physical-device checks.

The mobile tests run the installed Expo multipart encoder with a substitute native File and parse the resulting bytes. They do not exercise real native file access or render a device UI.

### Phase 5A validation and device checks

Run `npx --no-install tsc --noEmit -p apps/api/tsconfig.json`, `npx --no-install tsc --noEmit -p apps/mobile/tsconfig.json`, `npm run build:api`, and `node --test apps/api/test/locations.test.cjs apps/api/test/posting.test.cjs apps/api/test/social-api.test.cjs apps/mobile/test/*.test.cjs` from the root. Location tests cover provider configuration/errors/rate limits, debounce, stale replies, real coordinate selection, GPS denial/timeouts, repeated GPS selection, shared filters/radius, and separate Create location state. These use mocks rather than native devices or live provider calls.

On **both Android and iPhone**, after configuring the backend key and restarting the API:

1. Launch an SDK 58-compatible Expo Go using a fresh Metro QR. Deny GPS permission; type a city, neighborhood, address, and named place on Map and Create. Confirm predictions appear below the field, show secondary labels, and select without a map tap. Inspect attribution and actual provider coverage.
2. Type rapidly, clear the field, switch queries, and interrupt connectivity. Check that old results do not reappear, errors preserve the selected area, and keyboard taps/scrolling work on a small screen.
3. Choose a manual area, radius, category, and time filter. Tap **Use My Current Location**, grant permission, and confirm map recentering and refreshed activities with unchanged filters. Repeat after another manual selection. Test denied permission, Location Services off, slow GPS, and leaving Map during GPS lookup.
4. Return between Map and Nearby using Back and Explore; confirm center, radius, and filters persist. Select/confirm a different location in Create, then return to Nearby and confirm discovery stayed unchanged. Check rounded map bounds, safe areas, keyboard scrolling, and touch targets.

No physical-device testing or live Geoapify validation has been performed for Phase 5A. Bundle exports are JavaScript/Hermes build checks, not native release builds.

### iPhone checklist

1. Restart the API and Metro, sign in, and check Auth, Location, Nearby, Create, Activity, Profile, Map, and Details. Headers must clear the notch; navigation must clear the home indicator, without doubled padding.
2. Create a Now post using Camera, then another using Gallery. Fill title/description, choose category, search for a place, select a result, and confirm it. Verify the uploaded image, saved details, and exactly one new post in My Posts. Try an oversized or unsupported photo and confirm a helpful error.
3. With text already entered, use AI Autofill. Check that typed text stays intact and only empty fields fill; location and timing must stay unchanged. Edit suggestions. With AI unavailable, complete and publish manually.
4. After a publish request starts, simulate a connection interruption. Restore connectivity and use Retry publishing. Confirm one post and one associated photo. Repeated taps must not create duplicates.
5. Choose Later, select a future date/time with the native picker, and publish. Check Upcoming and All times; the post should not appear under Now before its start.
6. Deny device-location access. Search a city/address/named place on both Map and Create, inspect results, and adjust the pin. Try no results and offline search: show an error and keep the prior selection rather than moving to an unrelated area. Create must require confirmation.
7. On Map, try every radius from 0.5 to 50 miles. Check the circle, markers, zoom, callouts, and scrolling. The pin must survive radius changes. Return with Back and Explore and verify the Nearby radius. On a small iPhone, open the keyboard and Later picker: Publish, form fields, and navigation must remain accessible.

## Phase 5B: Profile and My Posts

Profile already supported initials, display-name viewing, notification preferences, a basic owned-post list, logout, and confirmed deletion. It now displays the authenticated email, an optional 300-character bio, and an exact count of the user's existing posts (including unpublished/expired posts, excluding deleted ones). Display-name and bio edits use `PATCH /api/users/me`; sign-in synchronization inserts missing profiles without overwriting saved edits. Account identity and email come from verified authentication, never the submitted body. Initials are used instead of adding avatar uploads. Push delivery remains unchanged.

**Migration required:** Review and manually apply `supabase/004_profile_bio.sql` in Supabase before saving bios. It adds only `profiles.bio`, with an empty default and a 300-character constraint. It does not alter RLS or existing tables' relationships. No migration was executed automatically. Display name is required and limited to 60 characters; bio is optional and can be cleared.

My Posts uses the existing `GET /api/posts/mine` array response with optional `filter`, `offset`, and `limit` parameters. Pages are capped at 40; the app loads 20 at a time. Filters are applied in the backend before pagination, always restricted to the authenticated creator:

- **Active:** published, unexpired, and activity time at or before now.
- **Upcoming:** published, unexpired, and activity time after now.
- **Expired:** explicit EXPIRED status or an elapsed expiration deadline.
- **All:** every status, including ready, processing, and failed activities.

Cards show the existing signed photo, title, location, date/time, derived status, and backend interest count. Pull to refresh, retry loading, and load more are supported; older filter responses are ignored.

`PATCH /api/posts/:id` is new because no activity-update route existed. It requires title, description, category, place name, coordinates, and a timezone-qualified activity timestamp, using the same validation as creation. The server checks ownership before writing, accepts only those fields, and checks that the activity still exists with the same status and start time, preventing concurrent rescheduling from mixing a stale start with a new deadline. Photo analysis must finish before editing. The photo, labels, comments, interests, and original publication timestamp are preserved. Text/location/category edits retain the existing expiration, even for expired posts. Explicitly changing the start time uses the configured lifetime from now for current activities or from the scheduled start for future ones; already-stale starts are rejected. An explicitly rescheduled, previously published EXPIRED activity becomes PUBLISHED again. Unpublished drafts remain unpublished.

The editor reuses shared location autocomplete, approximate public pins, and the existing native date/time picker. Selecting an activity location does not change the Nearby discovery area. Saving opens fresh Post Details; returning to My Posts, Nearby, or Map remounts and reloads their backend data. A 404 refresh clears previously loaded details so deleted activities are not actionable.

Deletion retains `DELETE /api/posts/:id`, verifies ownership, and removes only that activity plus its existing related records through the existing foreign-key cascades. It checks media lookup errors before deleting and removes the recorded photo afterward. If photo removal fails after row deletion, the API reports the partial failure and Profile retains **Retry deleting**, including after refresh. Repeated DELETE requests can finish cleanup in only `<verified-user-id>/<activity-id>/`; they never accept storage paths from the client or traverse other folders. Database and Storage operations remain separate, so finish this retry if cleanup fails. No background cleanup service was added.

### Phase 5B validation

From the repository root:

```sh
npm run typecheck --workspace=apps/api
npm run typecheck --workspace=apps/mobile
npm run build:api
node --test apps/api/test/posting.test.cjs apps/api/test/social-api.test.cjs apps/api/test/locations.test.cjs apps/api/test/profile-posts.test.cjs apps/mobile/test/*.test.cjs
git diff --check
```

Phase 5B checks passed: both TypeScript checks, NestJS build, 99 automated tests, Android/iOS bundle exports, and Git diff checks. Expo Doctor passed 19/20 checks; existing patches remain `expo` 58.0.25 versus expected ~58.0.26 and `expo-file-system` 58.0.13 versus expected ~58.0.14. Dependencies were left unchanged.

The focused API and screen tests use substitutes for Supabase and native controls. They check profile persistence requests and synchronization, exact counts, ownership, validation, filtered pagination, stale responses, edit-field restrictions, expiration, deletion/cleanup retry scoping, and stale detail links. They do not validate a live Supabase migration or physical-device layout.

After manually applying migration 004 and restarting the API, test on **iPhone and Android** with two accounts:

1. Edit display name and bio, refresh, log out, and sign back in. Confirm values persist, email remains correct, initials update, and changing notification preferences preserves the bio. Try an empty name and clear the bio.
2. Check every My Posts filter with current, future, expired, and unpublished activities. Verify thumbnails, dates/timezones, interest totals, exact statistics, pagination past 20 posts, pull to refresh, offline errors, and retry.
3. Edit title/description/category, select a searched location without a map tap, and change date/time. Verify details, My Posts, Nearby, and Map show the new values while comments, interests, photo, and discovery center stay intact. Metadata edits must keep the deadline; rescheduling must apply the configured lifetime.
4. Cancel deletion, then confirm it. Verify the activity disappears, old detail links fail, only its photo is removed, and unrelated posts remain. Simulate a storage failure and finish **Retry deleting** after a refresh.
5. With the other account, attempt PATCH/DELETE on the first account's post and include forged profile/post ownership fields. Requests must fail without modifying anything. Check safe areas, keyboard scrolling, dropdown taps, date pickers, and navigation on both devices.

Avatar/photo replacement, push delivery, authentication, existing social tables/RLS, and unrelated screens remain unchanged. No credentials, dependencies, or environment files were modified, and no commit was created.

## Phase 5C: Standard password recovery email

Login's **Forgot Password?** entry point now opens a dedicated HTTPS page, pre-filled with the email. The page sends Supabase's unchanged default reset email through the built-in sender using `resetPasswordForEmail()` and PKCE. Open that email in the same browser to set and confirm the new password. No custom SMTP, email-code template, developer build, or paid service is needed.

The browser initiates PKCE so it can prove recovery origin without sharing a native verifier or trusting a user-editable URL label. The page verifies the signed recovery claim and user/session identity, uses memory-only session tokens, and handles expiry, rate limits, password-policy failures, success, and browser sign-out retry. Normal Login, Signup, Logout, Profile, and mobile SecureStore behavior remain unchanged.

**Manual setup remains:** host the built `web/password-reset/dist/` over HTTPS, allowlist that exact URL in Supabase, and set it in `apps/mobile/src/lib/recovery-config.ts`. The page's public Supabase configuration reuses the current mobile project; no `.env` files were edited. Built-in email quotas and authorized-recipient restrictions still apply. See [exact hosting/dashboard steps and the real-email checklist](docs/password-recovery.md). Recovery has not been verified with a real email.

## First smoke test

- Create **two distinct accounts** (use two devices or sign out between tests).
- Account A: publish manually with a real activity photo. Then try AI autofill with some fields already filled, and confirm that existing text, location, and time stay unchanged. Test with AI unavailable as well.
- Account B: browse the same area, find A's post, open details, tap **Let's Go** once, then try tapping again. Check A's Activity inbox; only one notification should appear.
- Account B: leave a public comment. Account A: open the post and view it.
- Change radius to verify distance filtering, and check that expired posts leave the active feed.

## Safety and launch notes

This is an **MVP foundation, not a production-verified or deployed application**. The database tables have RLS enabled without client access policies, and the service-role key belongs in `apps/api/.env` only. Photos are private objects delivered through time-limited signed URLs. The API verifies user tokens and enforces post ownership. Use HTTPS for deployed APIs and stronger controls (rate limiting, anti-abuse/reporting, moderation, tighter CORS, monitoring, per-user upload quotas, job workers and secure push delivery) before a public launch. Add expiration cleanup for old stored media. Avoid presenting AI guesses as verified live facts.

**If the app won't connect:** check the laptop IP and port, `.env` files, same Wi-Fi, Supabase email confirmation, and firewall. Manual uploads need valid Supabase settings; AI autofill additionally needs the backend OpenAI key. Restart Expo after changing `.env` values.
