import type { OperationKey } from './generated/operations';
import { ProblemDetailSchema } from './generated/schemas';
import type { ProblemDetail } from './generated/schemas';

/**
 * - `problem`  - the service answered with a non-2xx status;
 * - `network`  - no response was received at all;
 * - `contract` - a 2xx response did not match the published schema.
 */
export type NotificationsErrorKind = 'problem' | 'network' | 'contract';

interface NotificationsErrorInit {
  kind: NotificationsErrorKind;
  operation: OperationKey;
  message: string;
  status?: number;
  problem?: ProblemDetail;
  retryAfterMs?: number;
  cause?: unknown;
}

/** Every failure the kit reports. Branch on `code`, never on `detail`. */
export class NotificationsError extends Error {
  readonly kind: NotificationsErrorKind;
  readonly operation: OperationKey;
  readonly status: number | undefined;
  /** Stable machine-readable code from the problem document. */
  readonly code: string | undefined;
  /** Localised summary and explanation, written for a human. */
  readonly title: string | undefined;
  readonly detail: string | undefined;
  /** For correlating with the service logs. */
  readonly traceId: string | undefined;
  readonly problem: ProblemDetail | undefined;
  /** From `Retry-After`, when the service sent one. */
  readonly retryAfterMs: number | undefined;

  constructor(init: NotificationsErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'NotificationsError';
    this.kind = init.kind;
    this.operation = init.operation;
    this.status = init.status;
    this.problem = init.problem;
    this.code = init.problem?.code ?? undefined;
    this.title = init.problem?.title ?? undefined;
    this.detail = init.problem?.detail ?? undefined;
    this.traceId = init.problem?.traceId ?? undefined;
    this.retryAfterMs = init.retryAfterMs;
  }
}

export function isNotificationsError(
  value: unknown
): value is NotificationsError {
  return value instanceof NotificationsError;
}

/** A problem body is read leniently: a gateway in front of the service may
 *  answer with something else entirely, and the status must still surface. */
export function parseProblem(data: unknown): ProblemDetail | undefined {
  const parsed = ProblemDetailSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

/** `Retry-After` is either delay-seconds or an HTTP-date (RFC 9110). */
export function parseRetryAfter(
  value: string | undefined,
  now: number = Date.now()
): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * Problem codes the service is known to emit, read from its source at the
 * pinned commit (see contract/SOURCE.md). The OpenAPI document publishes the
 * problem SHAPE, not this list, so treat it as a convenience: an unknown code
 * is always possible and must fall through to a generic message.
 */
export const PROBLEM_CODES = {
  INBOX_NOT_FOUND: 'error.notification.inbox.not-found',
  ANNOUNCEMENT_NOT_FOUND: 'error.notification.announcement.not-found',
  ANNOUNCEMENT_AUDIENCE_NOT_PERMITTED:
    'error.notification.announcement.audience-not-permitted',
  ANNOUNCEMENT_UNKNOWN_CATEGORY:
    'error.notification.announcement.unknown-category',
  ANNOUNCEMENT_WINDOW_TOO_LONG:
    'error.notification.announcement.window-too-long',
  BATCH_TOO_LARGE: 'error.notification.batch.too-large',
  DELIVERY_NOT_FOUND: 'error.notification.delivery.not-found',
  DELIVERY_ILLEGAL_TRANSITION: 'error.notification.delivery.illegal-transition',
  DELIVERY_CONTENT_UNAVAILABLE:
    'error.notification.delivery.content-unavailable',
  REQUEST_NOT_FOUND: 'error.notification.request.not-found',
  TEMPLATE_NOT_FOUND: 'error.notification.template.not-found',
  TEMPLATE_RENDER_FAILED: 'error.notification.template.render-failed',
  UPSTREAM_MAIL: 'error.notification.upstream.mail',
  UPSTREAM_TIMEOUT: 'error.notification.upstream.timeout',
  VALIDATION: 'ludwig.web.error.validation',
  UNAUTHORIZED: 'ludwig.web.error.unauthorized',
  FORBIDDEN: 'ludwig.web.error.forbidden',
  NOT_FOUND: 'ludwig.web.error.not-found',
  CONFLICT: 'ludwig.web.error.conflict',
  TOO_MANY_REQUESTS: 'ludwig.web.error.too-many-requests',
  UPSTREAM_UNAVAILABLE: 'ludwig.web.error.upstream-unavailable',
  INTERNAL: 'ludwig.web.error.internal',
} as const;
