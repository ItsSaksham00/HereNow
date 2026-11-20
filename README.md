# README

**HereNow — Unit and Component Tests**

HereNow is a mobile application that allows users to create and discover activities happening nearby. The application uses React Native, Expo, NestJS, TypeScript, and Supabase.

**Requirements:**
- Node.js and npm
- Visual Studio Code or another code editor

**Installation (Windows and Mac):**

1. Download or clone the HereNow project from the GitHub `testing` branch.
2. Open the HereNow folder in VS Code.
3. Open a terminal in the main project folder.
4. Install the required dependencies:

```bash
npm install
```

**Instructions for Testing:**

All commands below should be run from the main HereNow folder.

**For Windows (Command Prompt):**

Run all 18 assignment tests:

```cmd
node assignment-testing\run.cjs
```

Run PhotoForm tests separately:

```cmd
npx.cmd --no-install jest --config apps/mobile/jest.config.js --runInBand
```

Run API tests separately:

```cmd
npx.cmd --no-install jest --config apps/api/jest.config.js --runInBand
```

**For Mac (Terminal):**

Run all 18 assignment tests:

```bash
node assignment-testing/run.cjs
```

Run PhotoForm tests separately:

```bash
npx --no-install jest --config apps/mobile/jest.config.js --runInBand
```

Run API tests separately:

```bash
npx --no-install jest --config apps/api/jest.config.js --runInBand
```

**Expected Results:**

| Test Suite | Expected Result |
|---|---|
| Assignment 4 Tests | 18 passed, 0 failed |
| PhotoForm Tests | 3 passed, 0 failed |
| API Tests | 3 passed, 0 failed |

The assignment tests use fake data and do not require a live Supabase connection. The database SQL test scripts are not executed by these commands.

**GitHub Repository:**

https://github.com/ItsSaksham00/HereNow/tree/testing
