/**
 * Account-wide CPS (calls-per-second) limiter — a token bucket shared by EVERY
 * outbound placeCall(), whether it comes from the bulk worker, the dashboard
 * test call, or the external /api/trigger-call endpoint.
 *
 * This is the single source of truth for dial *rate*. It replaces the old
 * per-job placement-window pacing: instead of "keep N placements in flight per
 * job" (which let combined initiation across jobs blow past the account CPS and
 * relied on reactive 429 backoff), every placeCall must now `await takeCpsToken()`
 * before hitting Plivo, so the combined initiation rate never exceeds PLIVO_CPS.
 *
 * Tokens refill continuously at PLIVO_CPS/sec up to a small burst (PLIVO_CPS_BURST,
 * default = PLIVO_CPS, i.e. at most one second's worth queued ahead).
 *
 * In-process singleton, pinned on globalThis so hot-reload / multiple imports
 * share ONE bucket. This is correct for the current single-instance (systemd)
 * deploy. A multi-node deployment would need a shared store (Redis/Postgres)
 * instead — see note in worker.ts.
 */

class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private tokens: number;
  private last: number;
  private readonly waiters: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ratePerSec: number, burst: number) {
    this.capacity = Math.max(1, burst);
    this.tokens = this.capacity;
    this.refillPerMs = ratePerSec / 1000;
    this.last = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.last;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.last = now;
  }

  // Drain queued waiters as tokens become available; stop the timer when idle.
  private drain(): void {
    this.refill();
    while (this.waiters.length && this.tokens >= 1) {
      this.tokens -= 1;
      this.waiters.shift()!();
    }
    if (!this.waiters.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Resolve once one token is available (immediately if the bucket isn't empty). */
  take(): Promise<void> {
    this.refill();
    // Fast path: tokens free and nobody already waiting (keep FIFO fairness).
    if (!this.waiters.length && this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      if (!this.timer) {
        // Wake roughly every one-token interval to release waiters fairly.
        const ms = Math.min(50, Math.max(5, Math.ceil(1 / this.refillPerMs)));
        this.timer = setInterval(() => this.drain(), ms);
        if (typeof (this.timer as any).unref === "function") (this.timer as any).unref();
      }
    });
  }
}

const CPS = Number(process.env.PLIVO_CPS) || 125;
const BURST = Number(process.env.PLIVO_CPS_BURST) || CPS;

const G = globalThis as unknown as { __ivrCpsBucket?: TokenBucket };

function bucket(): TokenBucket {
  if (!G.__ivrCpsBucket) G.__ivrCpsBucket = new TokenBucket(CPS, BURST);
  return G.__ivrCpsBucket;
}

/** Block until the account-wide CPS bucket grants a token. Call before placeCall. */
export function takeCpsToken(): Promise<void> {
  return bucket().take();
}

export const PLIVO_CPS = CPS;
