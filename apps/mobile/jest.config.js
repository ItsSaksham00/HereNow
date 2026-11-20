module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/lib/api.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      // These utility tests mock native imports and run in Node, not Expo Go.
      tsconfig: {
        target: 'ES2022',
        module: 'CommonJS',
        moduleResolution: 'node',
        esModuleInterop: true,
        strict: true,
        skipLibCheck: true,
        lib: ['ES2022', 'DOM'],
      },
    }],
  },
};
