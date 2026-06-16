/**
 * Tiny in-process concurrency limiter (BUG 5).
 *
 * Bulk uploads each fire a burst of row inserts. If several large uploads land
 * at once they can exhaust the DB pool and the whole server starts returning
 * 500/503. This serializes upload processing to `maxConcurrent` at a time and
 * caps how many may wait — past that we fail fast with a BusyError so the client
 * gets a clean "retry in 10s" instead of a timeout or a crash.
 */

export class BusyError extends Error {
  constructor(message = "server busy") {
    super(message);
    this.name = "BusyError";
  }
}

export function createLimiter(maxConcurrent: number, maxQueue = Infinity) {
  let active = 0;
  const waiters: Array<() => void> = [];

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      if (waiters.length >= maxQueue) throw new BusyError();
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = waiters.shift();
      if (next) next();
    }
  };
}
