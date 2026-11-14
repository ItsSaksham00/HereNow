# HereNow — mobile MVP starter

**Project:** HereNow — *See what’s happening around you. Right now.*

**Stack:** React Native + TypeScript (Expo SDK 57), NestJS + TypeScript, Supabase Auth, Supabase PostgreSQL, private Supabase Storage, OpenAI vision. Same Git repository with two applications.

**Source of truth:** `references/HereNow_SystemAndProgramDesign.pdf` is the newer architecture specification. `references/HereNow_Updated_Design.html` is the visual style reference. See `DECISIONS_AND_ROADMAP.md` for the differences between those files and the older project plan.

## Start from zero (Mac or Windows)

Requires **Node.js 22.13+**, npm, an [Expo Go](https://expo.dev/go) phone app, a Supabase project, and an OpenAI API key for photo AI.

1. Extract this ZIP to a folder named `HereNowStarter` and open the folder in VS Code.
2. Create a project at **https://supabase.com/dashboard**. In **SQL Editor**, paste and run `supabase/001_init.sql` once. This creates the app tables, nearby-query function, atomic interest action, and private photo bucket. Supabase Auth is managed automatically.
3. Copy **`apps/api/.env.example` → `apps/api/.env`**. Enter the Supabase **Project URL** and the **secret/service-role key** from API Keys, plus `OPENAI_API_KEY`. Keep these secrets **only on the backend**. The sample values are not working credentials.
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

Scan the Expo QR with Expo Go, or launch a simulator. Register an account and sign in. If Supabase Auth has email confirmation enabled, first confirm your email. Test the nearby feed and location fallback. Posting requires a working OpenAI key.

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
3. **Nearby:** backend SQL selects unexpired, published activities in a radius, nearest first. Search and categories are applied to fetched results for this MVP.
4. **Create:** phone camera or gallery → foreground device location permission → approximate coordinates → private photo upload via NestJS → OpenAI generates title, description, category, tags → creator confirms → publish with automatic expiry.
5. **Explore:** activity details and map markers share the same backend records.
6. **Let’s Go:** one interest per user and post, never on own or expired posts. SQL saves interest + creator's in-app alert together; repeat taps do not duplicate records.
7. **Conversation:** public comments on active posts.
8. **Activity and profile:** inbox with read flags; own posts, failed AI retry, deletion, and sign-out.

## REST endpoints (all require `Authorization: Bearer <Supabase access token>`)

| Method | Endpoint | Role |
|---|---|---|
| POST | `/api/users/me` | Ensure profile exists |
| GET / PATCH | `/api/users/me` | Read / update profile |
| GET | `/api/posts/nearby?latitude=...&longitude=...&radius=10` | Nearby feed and markers |
| GET | `/api/posts/mine` | Own posts |
| GET | `/api/posts/:id` | Post detail |
| POST (multipart) | `/api/posts` | Upload photo + coordinate fields |
| POST | `/api/posts/:id/analyze` | Retry failed AI analysis |
| POST | `/api/posts/:id/publish` | Confirm and publish ready draft |
| DELETE | `/api/posts/:id` | Delete own post |
| POST | `/api/interests/:postId` | Let's Go |
| GET | `/api/notifications` | Activity inbox |
| PATCH | `/api/notifications/:id/read` | Mark read |
| GET / POST | `/api/comments/:postId` | Public comments |

## First smoke test

- Create **two distinct accounts** (use two devices or sign out between tests).
- Account A: create and publish a real activity photo. Don't submit somebody else's image; AI output must be reviewed for accuracy.
- Account B: browse the same area, find A's post, open details, tap **Let's Go** once, then try tapping again. Check A's Activity inbox; only one notification should appear.
- Account B: leave a public comment. Account A: open the post and view it.
- Change radius to verify distance filtering, and check that expired posts leave the active feed.

## Safety and launch notes

This is an **MVP foundation, not a production-verified or deployed application**. The database tables have RLS enabled without client access policies, and the service-role key belongs in `apps/api/.env` only. Photos are private objects delivered through time-limited signed URLs. The API verifies user tokens and enforces post ownership. Use HTTPS for deployed APIs and stronger controls (rate limiting, anti-abuse/reporting, moderation, tighter CORS, monitoring, per-user upload quotas, job workers and secure push delivery) before a public launch. Add expiration cleanup for old stored media. Avoid presenting AI guesses as verified live facts.

**If the app won't connect:** check the laptop IP and port, `.env` files, same Wi-Fi, Supabase email confirmation, and firewall. Missing API keys are the most common cause of upload failures. Restart Expo after changing `.env` values.
