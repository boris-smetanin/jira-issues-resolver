// Test helper: run a callback with a specific MASTER_KEY env value
// (or with MASTER_KEY explicitly unset when `key === undefined`), then
// restore whatever was set before. Used by crypto.test.ts to exercise
// different key states without mutating global env across tests.
//
// Crypto's getKey() reads process.env.MASTER_KEY lazily at every
// encrypt/decrypt call, so swapping the env var mid-test is sufficient
// — no module re-import needed.
export function withMasterKey<T>(key: string | undefined, fn: () => T): T {
  const prev = process.env.MASTER_KEY;
  if (key === undefined) {
    delete process.env.MASTER_KEY;
  } else {
    process.env.MASTER_KEY = key;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env.MASTER_KEY;
    } else {
      process.env.MASTER_KEY = prev;
    }
  }
}
