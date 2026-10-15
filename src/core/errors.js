// Error taxonomy. The runner maps each kind to retry and notification behavior.

export class CCError extends Error {
  constructor(message, { cause, details } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.details = details;
  }
  /** Short machine-readable kind stored on the run record. */
  get kind() { return 'error'; }
  /** Whether the runner may retry the job after this error. */
  get retryable() { return true; }
}

/** Invalid configuration. Never retried; fails before any job runs. */
export class ConfigError extends CCError {
  get kind() { return 'config'; }
  get retryable() { return false; }
}

/** A page no longer matches what the parser expects (missing selector, unexpected shape). */
export class ParseError extends CCError {
  get kind() { return 'parse'; }
}

/** Fewer items than the job config says to expect. */
export class ExpectationError extends CCError {
  get kind() { return 'expectation'; }
}

/** A run(ctx) that exceeded its timeout. */
export class TimeoutError extends CCError {
  get kind() { return 'timeout'; }
}

/** Network or HTTP failure. Retryable for 5xx/429/network; not for 4xx. */
export class FetchError extends CCError {
  constructor(message, { status, ...rest } = {}) {
    super(message, rest);
    this.status = status;
  }
  get kind() { return 'fetch'; }
  get retryable() { return this.status === undefined || this.status >= 500 || this.status === 429 || this.status === 408; }
}

/** robots.txt or job policy forbids the request. Never retried. */
export class PolicyError extends CCError {
  get kind() { return 'policy'; }
  get retryable() { return false; }
}

/** A job returned items that fail normalization. A bug in the job, so not retried. */
export class ItemError extends CCError {
  get kind() { return 'item'; }
  get retryable() { return false; }
}

export function errorKind(err) {
  return err instanceof CCError ? err.kind : 'error';
}

export function isRetryable(err) {
  return err instanceof CCError ? err.retryable : true;
}
