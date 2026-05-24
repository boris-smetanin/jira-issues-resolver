// Slice 15: process-wide "stop attempt" signal registry.
//
// The orchestrator registers an AbortController when `runAttempt` begins
// and unregisters in `finally`. The HTTP route handler for
// POST /resolve-attempts/:id/stop calls `requestStop(id)`, which fires
// the controller's `.abort()` — the orchestrator observes the signal at
// state-transition checkpoints (and Sandcastle observes it during the
// long agent step).
//
// In-memory Map is the right shape per the slice spec: a stop is
// meaningful only while the attempt is running, which is process-local
// by construction (the scheduler is in-process). On process death the
// boot-time `markOrphanedAttempts` flips any non-terminal rows to
// FAILED with `error_reason = 'orphaned at boot'`, so a stop request
// that arrives during a restart-shaped crash isn't silently dropped —
// it just becomes an orphan reconciliation instead.

const controllers = new Map<string, AbortController>();

export function register(attemptId: string): AbortSignal {
  const existing = controllers.get(attemptId);
  if (existing) return existing.signal;
  const controller = new AbortController();
  controllers.set(attemptId, controller);
  return controller.signal;
}

export function unregister(attemptId: string): void {
  controllers.delete(attemptId);
}

// Returns true if a controller was present (= the attempt was in
// flight and we successfully fired abort). False means the attempt
// either never started, already terminated, or lives in a different
// process — caller decides whether to surface a 404 vs a noop.
export function requestStop(attemptId: string): boolean {
  const controller = controllers.get(attemptId);
  if (!controller) return false;
  controller.abort();
  return true;
}

// Test-only escape hatch — never call from prod code.
export function _resetForTests(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
}
