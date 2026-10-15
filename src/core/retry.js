import { TimeoutError, isRetryable } from './errors.js';

/** Resolve after ms; rejects early if the signal aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

/**
 * Run fn(signal) with a hard timeout. The signal aborts at the deadline so cooperative
 * work (fetch, Playwright) can stop; the returned promise rejects with TimeoutError either way.
 */
export async function withTimeout(fn, ms, label = 'operation') {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new TimeoutError(`${label} timed out after ${ms} ms`);
      controller.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Exponential backoff with full jitter, using the injected rng for reproducibility. */
export function backoffDelay(attempt, { baseMs = 2000, maxMs = 60000, rng = Math.random } = {}) {
  const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(cap / 2 + rng() * (cap / 2));
}

/**
 * Retry fn(attempt) up to `retries` extra times on retryable errors.
 * Returns { value, attempts }; on final failure throws the last error with `.attempts` set.
 */
export async function withRetry(fn, { retries = 2, baseMs = 2000, maxMs = 60000, rng = Math.random, onRetry, sleepFn = sleep } = {}) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt };
    } catch (err) {
      if (attempt > retries || !isRetryable(err)) {
        if (err && typeof err === 'object') err.attempts = attempt;
        throw err;
      }
      const delay = backoffDelay(attempt, { baseMs, maxMs, rng });
      await onRetry?.(err, attempt, delay);
      await sleepFn(delay);
    }
  }
}
