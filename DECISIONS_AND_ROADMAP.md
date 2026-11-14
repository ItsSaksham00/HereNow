# HereNow — implementation decisions & fast project roadmap

## Source alignment

The **system-design PDF (Nov 6, 2026)** describes photo-only posting: a user selects or takes a photo and AI automatically generates title, description, category, and labels; device location is obtained; user does not type post details. The older project-plan DOCX and the HTML mockup instead show manual text and AI suggestions that can be edited. **This starter follows the newer PDF for post creation**, but requires creator confirmation before publication. Final policy can be revisited with the team.

The UI mockup adds public comments and user-selected browsing areas, so these are included as valuable MVP extras. The map lets users set a manual **browsing center** without device permission, but actual **new-post location** requires device location, consistent with the newer PDF. The starter approximates coordinates (3 decimal places) for privacy. Verify that this meets the course requirements and actual gathering-place accuracy.

## Already created in this starter

- React Native Expo TypeScript mobile app, inspired by HTML design's forest / lime / warm-white theme.
- Welcome, login, signup, area selection, nearby feed, map, post detail, photo posting, Activity inbox, Profile.
- Supabase Auth with mobile secure session storage; NestJS server-side token validation.
- Supabase SQL schema for profiles, posts, media, AI jobs, interests, notifications, comments.
- Private storage with signed image URLs and a 6 MB maximum image upload.
- AI model integration producing short title, description, category, and labels from the image.
- Draft → READY → PUBLISHED workflow; four-hour default expiry.
- SQL nearby feed sorted nearest first, radius and pagination.
- Atomic / idempotent interest and in-app notification creation.
- Comment endpoint and comment UI; author-only post deletion; retry of failed AI.

## Deferred, in order

**Phase 1 QA:** Install dependencies, resolve integration differences in your dev environment, run the SQL migration, test all screens on iOS/Android, fix issues, and improve image upload errors and onboarding. This source bundle was *syntax-checked only*; no live device or Supabase integration was available to execute here.

**Phase 2 reliability:** Replace synchronous photo analysis with a background queue/worker, robust retry/backoff, explicit jobs dashboard, expired-photo cleanup, and tighter request/rate limits. Improve filtering in SQL before pagination, indexed geo search (e.g. PostGIS), and feed paging.

**Phase 3 notifications:** Mobile push token registration, opt-in permissions, Expo/FCM/APNs delivery worker, bounded retries, persisted delivery outcomes. In-app notification records already work without push permission.

**Phase 4 other specified requirements:** Text search accuracy, spoken search where supported (microphone permission), reporting and admin review (FR8), saving posts and reminders (FR7), richer creator editing flows if adopted, map place search, moderation and abuse controls, background refresh via WebSockets when needed.

## Important design gaps to decide together

- **AI vs text editing:** PDF says photo-only, HTML and first plan allow manual editing. Starter uses photo-only + confirmation.
- **Location privacy:** real-time public coordinates can reveal personal locations. Starter rounds new post coordinates but production should support user-approved public meeting points.
- **Push notifications:** planned, not delivered; Activity inbox already saves notifications.
- **Hosting:** no deployment provider configured; local NestJS server + Supabase hosted data for development.
- **AI service:** this starter chooses OpenAI vision as an implementation choice. Original architecture leaves the vendor unspecified.
- **Posts and expiry:** starter defaults to four hours (configurable), not a fixed requirement from the source documents.
