const path = require('node:path');

// Reuses the working Jest setup while selecting only the two assignment files.
module.exports = {
  projects: [
    {
      ...require('../apps/api/jest.config.js'),
      rootDir: path.resolve(__dirname, '../apps/api'),
      testMatch: ['<rootDir>/src/auth/auth.guard.spec.ts'],
    },
    {
      ...require('../apps/mobile/jest.config.js'),
      rootDir: path.resolve(__dirname, '../apps/mobile'),
    },
  ],
};
