import type { OperationKey } from './generated/operations';
import { isNotificationsError } from './errors';

/**
 * What may be repeated, and when.
 *
 * Reads are always safe. Of the commands, the contract declares these
 * idempotent: the three inbox transitions and mark-all-read, dismissing an
 * announcement, and cancelling an email run. Submitting a notification is
 * safe to repeat only with an `Idempotency-Key`. Everything else changes
 * state on each call and is never retried automatically.
 */
export const IDEMPOTENT_COMMANDS: ReadonlySet<OperationKey> =
  new Set<OperationKey>([
    'POST /inbox/{id}/seen',
    'POST /inbox/{id}/read',
    'POST /inbox/read',
    'POST /inbox/{id}/dismiss',
    'POST /announcements/{id}/dismiss',
    'POST /announcements/{id}/email-run/cancellation',
  ]);

const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

/** Worth another attempt: nothing came back, or the service said "later". */
export function isRetryable(error: unknown): boolean {
  if (!isNotificationsError(error)) return false;
  if (error.kind === 'network') return true;
  if (error.kind === 'contract') return false;
  return error.status !== undefined && RETRYABLE_STATUSES.has(error.status);
}

export interface RetryOptions {
  /** Attempts after the first one. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULTS = { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30_000 };

export function shouldRetry(
  failureCount: number,
  error: unknown,
  options: RetryOptions = {}
): boolean {
  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
  return failureCount < maxRetries && isRetryable(error);
}

/** `Retry-After` wins when present; otherwise exponential backoff. */
export function retryDelay(
  attemptIndex: number,
  error: unknown,
  options: RetryOptions = {}
): number {
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  if (isNotificationsError(error) && error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, maxDelayMs);
  }
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  return Math.min(baseDelayMs * 2 ** attemptIndex, maxDelayMs);
}
