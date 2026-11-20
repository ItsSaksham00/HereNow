# HereNow

HereNow helps people find nearby activities, create posts, and connect through
comments and the Let's Go interest button.

## Technologies

- React Native, Expo SDK 58, and TypeScript
- NestJS and TypeScript
- Supabase Authentication, PostgreSQL, and Storage
- Jest and Node.js tests

## Installation

Use Node.js 22.13 or newer and npm. From the repository root:

```sh
npm install
```

## Configuration

Copy `apps/api/.env.example` to `apps/api/.env` and
`apps/mobile/.env.example` to `apps/mobile/.env`.

Set the backend Supabase URL and service-role key. Set the mobile Supabase URL,
public publishable key, and API URL. Keep private keys on the backend only.
For a phone, use the computer's local network address for the API URL.
Apply the numbered migrations in `supabase/` to your own Supabase project.
The `Test*.Database.sql` files are separate tests, not migrations.
Optional photo suggestions use `OPENAI_API_KEY`; place search uses
`GEOAPIFY_API_KEY` in the backend environment.

## Run the app

From the repository root, start the backend:

```sh
npm run api
```

In a second terminal, start mobile and open it with compatible Expo Go:

```sh
npm run mobile
```

## Assignment 4 tests

```sh
node assignment-testing/run.cjs
```

The suite runs 18 tests: 12 unit tests and 6 component tests.
Unit tests check authentication, photo forms, activity input, and search radius.
Component tests check publishing and nearby retrieval through real app modules.
Tests use fake data and do not require production Supabase access.
