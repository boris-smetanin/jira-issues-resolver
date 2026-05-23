// Vitest setup file. Runs before any test module imports, so we use it
// to set env vars that the source's bootstrap code (core/config.ts) reads
// at import time. Without these, importing anything that transitively
// imports config.ts blows up before a single test runs.
//
// MASTER_KEY: fixed deterministic value (32 zero-then-one bytes) so
// crypto.test.ts can override with its own keys via withMasterKey
// without leaking real keys to disk. Any test that depends on crypto
// behavior sets its own key.
//
// DATABASE_URL: tests don't actually connect (the four Core 4 modules
// don't touch Postgres), but config.ts's required() check runs at
// import. A dummy URL satisfies it.
process.env.MASTER_KEY ||= Buffer.alloc(32, 1).toString('base64');
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test_unused';
