# HereNow — mobile MVP starter

**Project:** HereNow — *See what’s happening around you. Right now.*

**Stack:** React Native + TypeScript (Expo SDK 58), NestJS + TypeScript, Supabase Auth, Supabase PostgreSQL, private Supabase Storage, OpenAI vision. Same Git repository with two applications.

**Source of truth:** `references/HereNow_SystemAndProgramDesign.pdf` is the newer architecture specification. `references/HereNow_Updated_Design.html` is the visual style reference. See `DECISIONS_AND_ROADMAP.md` for the differences between those files and the older project plan.

## Start from zero (Mac or Windows)

Requires **Node.js 22.13+**, npm, an [Expo Go](https://expo.dev/go) phone app, a Supabase project, and optionally an OpenAI API key for photo suggestions. Manual posting does not require an AI key.

1. Extract this ZIP to a folder named `HereNowStarter` and open the folder in VS Code.
2. Create a project at **https://supabase.com/dashboard**. In **SQL Editor**, paste and run `supabase/001_init.sql` once. This creates the app tables, nearby-query function, atomic interest action, and private photo bucket. Supabase Auth is managed automatically. Then run `supabase/002_activity_posting.sql` for activity times, filtered feeds, and duplicate-comment protection. On an existing project, run only `002_activity_posting.sql` after backing up your database. Apply this migration before starting the updated API; the app does not run migrations automatically.
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
6. **Let’s Go:** one interest per user and post, never on own or expired posts. SQL saves interest + creator's in-app alert together; repeat taps do not duplicate records.
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
node --test apps/api/test/posting.test.cjs
node --test apps/mobile/test/upload-location.test.cjs
```

The tests use mocked database/storage calls and do not contact Supabase or AI. After applying the SQL migration, check the real upload, filters, comment counts, and retry behavior on a device. No migration is executed by these tests.

## Mobile upload and location behavior

Photo uploads use `File` from `expo-file-system` and `expo/fetch`. Expo SDK 58's multipart encoder rejects the old React Native `{ uri, name, type }` object. The app sends the real file as `photo`, keeps the bearer token, and lets Expo generate the multipart boundary. A failed publish keeps the submitted form and request ID for retry, so a lost response can be recovered without creating another post. Validation errors allow correcting the form.

The native date/time picker and file-system module are SDK-compatible dependencies. Restart Metro after updating dependencies (`cd apps/mobile` then `npx expo start --clear`). Expo Go must match SDK 58. If you use a custom development build, rebuild it to include the native date/time picker.

All screens share a root safe-area wrapper; shared layouts do not add another safe area. Create defaults to Now, keeps optional AI and labels compact, and places Publish below the scrollable form. Map has a bounded rounded viewport and a Search radius menu. Radius is shared with Nearby, including when returning with Back.

Place search uses the stable Expo 58 `expo-location` geocoder (`geocodeAsync` and `reverseGeocodeAsync`), avoiding the beta native module required by the `/next` entry point. Search is explicit, not live autocomplete. It can return one or more real address/place matches with readable labels and needs network/provider availability. Named-business coverage varies by platform; Android devices without a geocoding backend may not support lookup. No external provider or API key is added. iOS address search does not request device-location permission. Android’s stable geocoder requires foreground permission; the app requests it when permitted and explains how to use a manual pin if permission is denied. Manual map selection and radius filtering still work without GPS. There is no fabricated-coordinate fallback. Device coordinates used for public posts are rounded, and the user must confirm the selected place.

If Expo Go reports `Cannot find native module 'LocationModuleNext'`, make sure it is loading the updated code. The app uses the stable location entry point; it does not need that beta native module. Update Expo Go to a version compatible with SDK 58, fully close it on the phone, stop Metro, then restart from `apps/mobile` with `npx expo start --clear`. Scan the new QR code rather than reopening an old recent project. A JavaScript reload cannot install a missing native module into an older Expo Go binary. On Android, test address search with foreground permission allowed, denied, and previously denied; manual map selection must remain available. On iPhone, address search must work without asking for device-location permission. On both, test My location, pin confirmation, map markers, and radius changes returning to Nearby. Bundle exports and mocked tests do not replace these physical-device checks.

The mobile tests run the installed Expo multipart encoder with a substitute native File and parse the resulting bytes. They do not exercise real native file access or render a device UI.

### iPhone checklist

1. Restart the API and Metro, sign in, and check Auth, Location, Nearby, Create, Activity, Profile, Map, and Details. Headers must clear the notch; navigation must clear the home indicator, without doubled padding.
2. Create a Now post using Camera, then another using Gallery. Fill title/description, choose category, search for a place, select a result, and confirm it. Verify the uploaded image, saved details, and exactly one new post in My Posts. Try an oversized or unsupported photo and confirm a helpful error.
3. With text already entered, use AI Autofill. Check that typed text stays intact and only empty fields fill; location and timing must stay unchanged. Edit suggestions. With AI unavailable, complete and publish manually.
4. After a publish request starts, simulate a connection interruption. Restore connectivity and use Retry publishing. Confirm one post and one associated photo. Repeated taps must not create duplicates.
5. Choose Later, select a future date/time with the native picker, and publish. Check Upcoming and All times; the post should not appear under Now before its start.
6. Deny device-location access. Search a city/address/named place on both Map and Create, inspect results, and adjust the pin. Try no results and offline search: show an error and keep the prior selection rather than moving to an unrelated area. Create must require confirmation.
7. On Map, try every radius from 0.5 to 50 miles. Check the circle, markers, zoom, callouts, and scrolling. The pin must survive radius changes. Return with Back and Explore and verify the Nearby radius. On a small iPhone, open the keyboard and Later picker: Publish, form fields, and navigation must remain accessible.

## First smoke test

- Create **two distinct accounts** (use two devices or sign out between tests).
- Account A: publish manually with a real activity photo. Then try AI autofill with some fields already filled, and confirm that existing text, location, and time stay unchanged. Test with AI unavailable as well.
- Account B: browse the same area, find A's post, open details, tap **Let's Go** once, then try tapping again. Check A's Activity inbox; only one notification should appear.
- Account B: leave a public comment. Account A: open the post and view it.
- Change radius to verify distance filtering, and check that expired posts leave the active feed.

## Safety and launch notes

This is an **MVP foundation, not a production-verified or deployed application**. The database tables have RLS enabled without client access policies, and the service-role key belongs in `apps/api/.env` only. Photos are private objects delivered through time-limited signed URLs. The API verifies user tokens and enforces post ownership. Use HTTPS for deployed APIs and stronger controls (rate limiting, anti-abuse/reporting, moderation, tighter CORS, monitoring, per-user upload quotas, job workers and secure push delivery) before a public launch. Add expiration cleanup for old stored media. Avoid presenting AI guesses as verified live facts.

**If the app won't connect:** check the laptop IP and port, `.env` files, same Wi-Fi, Supabase email confirmation, and firewall. Manual uploads need valid Supabase settings; AI autofill additionally needs the backend OpenAI key. Restart Expo after changing `.env` values.
