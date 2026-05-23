import { defineConfig } from 'vitest/config';

// Slice 0013: tests for the Core 4 modules (Crypto, Prompt Builder,
// Branch Resolver, Commit Finalizer). Vitest is on Vite under the hood;
// the .js-extension relative imports the source uses (per the project's
// TS ESM convention) resolve transparently to .ts here, same as in
// tsx-driven dev/prod.
//
// `pool: 'forks'` over the default 'threads' so each test file gets a
// fresh process — important for the git-binary tests, which spawn
// subprocesses and write to tmp dirs. Threads would share env state
// (MASTER_KEY, cwd) across files.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__test__/**'],
    },
  },
});
