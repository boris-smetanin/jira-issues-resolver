// Process-wide semaphore that bounds the number of `runAttempt` calls in
// flight at once. `init` is called from boot after migrations are applied;
// `withGate(fn)` queues `fn` until a slot is free, runs it, and drains the
// next waiter on release.
//
// Why hand-rolled instead of `p-limit`: zero new deps, and the FIFO queue
// is trivial. We need only one of these per process.

type Waiter = () => void;

let cap = 3;
let active = 0;
const waiters: Waiter[] = [];

export function initConcurrencyGate(newCap: number): void {
  cap = Math.max(1, newCap);
}

export function getConcurrencyCap(): number {
  return cap;
}

export function getActiveCount(): number {
  return active;
}

// Caller-facing: await this to acquire a slot, run the work, then the
// finally branch releases it. Bypasses if the cap is already misconfigured
// to be ≤ 0.
export async function withGate<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

function acquire(): Promise<void> {
  if (active < cap) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;
  // The cap could shrink while waiters are queued; only wake one per
  // release and only if we're now under cap.
  if (active < cap) {
    const next = waiters.shift();
    if (next) next();
  }
}
