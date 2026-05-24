import { afterEach, describe, expect, it } from 'vitest';
import { _resetForTests, register, requestStop, unregister } from './stop.registry.js';

// Slice 15: the registry is pure in-memory state, so we exercise it
// directly here. The orchestrator-side integration (register at
// runAttempt start; unregister in finally; abort propagation to
// Sandcastle) is exercised by the manual smoke run instead — wiring
// up a DB + mock agent in a unit test would test our scaffolding
// rather than the registry contract.

describe('stop.registry', () => {
  afterEach(() => _resetForTests());

  it('register returns a non-aborted signal', () => {
    const signal = register('attempt-a');
    expect(signal.aborted).toBe(false);
  });

  it('register is idempotent — re-registering the same id returns the original signal', () => {
    const first = register('attempt-a');
    const second = register('attempt-a');
    // Same signal object — caller doesn't need to worry about losing
    // the abort listener if it accidentally re-registers.
    expect(first).toBe(second);
  });

  it('requestStop fires abort on the registered controller and returns true', () => {
    const signal = register('attempt-a');
    const fired = requestStop('attempt-a');
    expect(fired).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it('requestStop returns false when no controller is registered', () => {
    const fired = requestStop('attempt-ghost');
    expect(fired).toBe(false);
  });

  it('unregister removes the controller without aborting it', () => {
    const signal = register('attempt-a');
    unregister('attempt-a');
    expect(signal.aborted).toBe(false);
    // Subsequent requestStop is a no-op (controller is gone).
    expect(requestStop('attempt-a')).toBe(false);
  });

  it('multiple ids are independent', () => {
    const a = register('attempt-a');
    const b = register('attempt-b');
    requestStop('attempt-a');
    expect(a.aborted).toBe(true);
    expect(b.aborted).toBe(false);
  });

  it('AbortSignal abort handlers fire synchronously when requestStop is called', () => {
    const signal = register('attempt-a');
    let fired = false;
    signal.addEventListener('abort', () => {
      fired = true;
    });
    requestStop('attempt-a');
    expect(fired).toBe(true);
  });
});
