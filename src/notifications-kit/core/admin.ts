/**
 * Plain logic behind the administration screens: turning form state into
 * requests the contract accepts, and reading what the service sends back.
 * Every limit here comes from the contract or from the service configuration
 * at the pinned commit (see contract/SOURCE.md).
 */
import type { Channel } from './api';
import type {
  DeliveryResponse,
  OperationResponse,
  PublishAnnouncementRequest,
  RecipientDto,
  SendNotificationRequest,
} from './generated/schemas';
import { odata } from './odata';
import type { ODataExpression } from './odata';
import { missingVariables, toVariables } from './templates';
import type { TemplateDescriptor } from './templates';

export type SendCategoryClass = SendNotificationRequest['categoryClass'];
export type SendPriority = SendNotificationRequest['priority'];
export type AudienceType = PublishAnnouncementRequest['audienceType'];
export type DeliveryStatus = NonNullable<DeliveryResponse['status']>;

/** `SendNotificationRequest.recipients` maxItems. */
export const MAX_RECIPIENTS = 500;
/** `ludwig.notification.announcements.max-visibility-window`. */
export const DEFAULT_MAX_VISIBILITY_DAYS = 90;
/** Template key pattern from the contract. */
export const TEMPLATE_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const DAY_MS = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- recipients

export interface RecipientDraft {
  /** Stable key for the UI. */
  id: string;
  /** What the person sees. */
  label: string;
  /** Exactly one of the two: a user id the service resolves, or a raw address. */
  userId?: string;
  address?: string;
  hint?: string;
}

/** A typed value becomes an address when it looks like an e-mail, a user id
 *  otherwise. The service resolves a user id to its contact addresses. */
export function recipientFromInput(raw: string): RecipientDraft | null {
  const value = raw.trim();
  if (!value) return null;
  return EMAIL.test(value)
    ? { id: `address:${value.toLowerCase()}`, label: value, address: value }
    : { id: `user:${value}`, label: value, userId: value };
}

export function toRecipientDto(draft: RecipientDraft): RecipientDto {
  return draft.userId !== undefined
    ? { userId: draft.userId }
    : { address: draft.address };
}

// ---------------------------------------------------------------------- send

export interface SendDraft {
  template: TemplateDescriptor | null;
  /** Used when the key is typed by hand rather than picked from the catalogue. */
  customTemplateKey: string;
  variables: Record<string, string>;
  /** Extra name/value pairs for a hand-typed template. */
  customVariables: VariablePair[];
  channels: Channel[];
  category: string;
  categoryClass: SendCategoryClass;
  priority: SendPriority;
  recipients: RecipientDraft[];
  /** `null` — send now. */
  scheduledAt: string | null;
}

export type SendField =
  | 'template'
  | 'variables'
  | 'channels'
  | 'category'
  | 'recipients'
  | 'scheduledAt';

export type SendErrors = Partial<Record<SendField, string>>;

export function templateKeyOf(draft: {
  template: TemplateDescriptor | null;
  customTemplateKey: string;
}): string {
  return draft.template?.key ?? draft.customTemplateKey.trim();
}

export interface VariablePair {
  name: string;
  value: string;
}

/** Catalogue variables win over a hand-typed pair with the same name. */
export function variablesOf(draft: {
  variables: Record<string, string>;
  customVariables?: readonly VariablePair[];
}): Record<string, string> {
  const custom: Record<string, string> = {};
  for (const pair of draft.customVariables ?? []) {
    if (pair.name.trim()) custom[pair.name.trim()] = pair.value;
  }
  return toVariables({ ...custom, ...draft.variables });
}

/** Error codes, not text: the UI owns the wording. */
export function validateSend(draft: SendDraft, now = Date.now()): SendErrors {
  const errors: SendErrors = {};
  const key = templateKeyOf(draft);
  if (!key) errors.template = 'required';
  else if (!TEMPLATE_KEY_PATTERN.test(key)) errors.template = 'pattern';

  if (
    draft.template &&
    missingVariables(draft.template, draft.variables).length
  ) {
    errors.variables = 'required';
  }
  if (draft.channels.length === 0) errors.channels = 'required';
  if (!draft.category.trim()) errors.category = 'required';
  else if (draft.category.trim().length > 128) errors.category = 'tooLong';

  if (draft.recipients.length === 0) errors.recipients = 'required';
  else if (draft.recipients.length > MAX_RECIPIENTS)
    errors.recipients = 'tooMany';

  if (draft.scheduledAt !== null) {
    const at = Date.parse(draft.scheduledAt);
    if (Number.isNaN(at)) errors.scheduledAt = 'invalid';
    else if (at <= now) errors.scheduledAt = 'past';
  }
  return errors;
}

export function buildSendRequest(draft: SendDraft): SendNotificationRequest {
  return {
    templateKey: templateKeyOf(draft),
    variables: variablesOf(draft),
    channels: [...new Set(draft.channels)],
    category: draft.category.trim(),
    categoryClass: draft.categoryClass,
    priority: draft.priority,
    recipients: draft.recipients.map(toRecipientDto),
    ...(draft.scheduledAt !== null
      ? { scheduledAt: new Date(draft.scheduledAt).toISOString() }
      : {}),
  };
}

// ------------------------------------------------------------------- publish

export interface PublishDraft {
  category: string;
  audienceType: AudienceType;
  audienceValue: string;
  template: TemplateDescriptor | null;
  customTemplateKey: string;
  variables: Record<string, string>;
  customVariables: VariablePair[];
  /** `null` — visible from the moment of publishing. */
  visibleFrom: string | null;
  visibleUntil: string;
}

export type PublishField =
  | 'category'
  | 'audience'
  | 'template'
  | 'variables'
  | 'visibleFrom'
  | 'visibleUntil';

export type PublishErrors = Partial<Record<PublishField, string>>;

export function validatePublish(
  draft: PublishDraft,
  options: { maxVisibilityDays?: number; now?: number } = {}
): PublishErrors {
  const now = options.now ?? Date.now();
  const maxDays = options.maxVisibilityDays ?? DEFAULT_MAX_VISIBILITY_DAYS;
  const errors: PublishErrors = {};

  if (!draft.category.trim()) errors.category = 'required';
  if (draft.audienceType === 'ROLE' && !draft.audienceValue.trim()) {
    errors.audience = 'required';
  }
  const key = templateKeyOf(draft);
  if (!key) errors.template = 'required';
  else if (!TEMPLATE_KEY_PATTERN.test(key)) errors.template = 'pattern';
  if (
    draft.template &&
    missingVariables(draft.template, draft.variables).length
  ) {
    errors.variables = 'required';
  }

  const from = draft.visibleFrom === null ? now : Date.parse(draft.visibleFrom);
  const until = Date.parse(draft.visibleUntil);
  if (Number.isNaN(from)) errors.visibleFrom = 'invalid';
  if (!draft.visibleUntil || Number.isNaN(until))
    errors.visibleUntil = 'required';
  else if (until <= Math.max(from, now)) errors.visibleUntil = 'beforeStart';
  else if (until - from > maxDays * DAY_MS) errors.visibleUntil = 'tooLong';
  return errors;
}

export function buildPublishRequest(
  draft: PublishDraft
): PublishAnnouncementRequest {
  return {
    category: draft.category.trim(),
    audienceType: draft.audienceType,
    ...(draft.audienceType === 'ROLE'
      ? { audienceValue: draft.audienceValue.trim() }
      : {}),
    templateKey: templateKeyOf(draft),
    variables: variablesOf(draft),
    ...(draft.visibleFrom !== null
      ? { visibleFrom: new Date(draft.visibleFrom).toISOString() }
      : {}),
    visibleUntil: new Date(draft.visibleUntil).toISOString(),
  };
}

// ---------------------------------------------------------------- operations

/** The envelope says so itself when it can; the status decides otherwise. */
export function isTerminal(operation: OperationResponse | undefined): boolean {
  if (!operation) return false;
  if (typeof operation.terminal === 'boolean') return operation.terminal;
  return (
    operation.status !== undefined &&
    operation.status !== null &&
    operation.status !== 'PENDING' &&
    operation.status !== 'RUNNING'
  );
}

/** 0..1, or `null` while the total is still unknown (it is nullable until
 *  the audience has been walked). */
export function progressRatio(
  operation: OperationResponse | undefined
): number | null {
  const total = operation?.progress?.total;
  const completed = operation?.progress?.completed ?? 0;
  if (!total || total <= 0) return null;
  return Math.min(1, completed / total);
}

// ---------------------------------------------------------------- deliveries

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'ACCEPTED',
  'PENDING',
  'CLAIMED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'DEAD',
  'SUPPRESSED',
  'CANCELLED',
  'BATCHED',
  'COLLAPSED',
];

/** Finished deliveries never change again. */
export const FINAL_STATUSES: ReadonlySet<DeliveryStatus> = new Set([
  'DELIVERED',
  'DEAD',
  'SUPPRESSED',
  'CANCELLED',
  'COLLAPSED',
]);

/** "Requeue a DEAD delivery" — the only state retry accepts. */
export const canRetryDelivery = (status: DeliveryStatus | null | undefined) =>
  status === 'DEAD';

/** "Cancel a delivery that has not been sent": still waiting in the queue. */
export const canCancelDelivery = (status: DeliveryStatus | null | undefined) =>
  status === 'ACCEPTED' || status === 'PENDING';

export interface DeliveryFilter {
  statuses?: DeliveryStatus[];
  channel?: Channel;
  templateKey?: string;
  requestId?: string;
  /** ISO instants. */
  createdFrom?: string;
  createdTo?: string;
}

/** Only properties the delivery entity marks @Filterable for every support
 *  role (recipientUserId is admin-only and left out). */
export function deliveryFilter(
  filter: DeliveryFilter
): ODataExpression | undefined {
  return odata.and(
    filter.statuses?.length
      ? filter.statuses.length === 1
        ? odata.eq('status', filter.statuses[0] as string)
        : odata.in('status', filter.statuses)
      : undefined,
    filter.channel ? odata.eq('channel', filter.channel) : undefined,
    filter.templateKey?.trim()
      ? odata.eq('templateKey', filter.templateKey.trim())
      : undefined,
    filter.requestId?.trim()
      ? `requestId eq ${filter.requestId.trim()}`
      : undefined,
    filter.createdFrom ? odata.ge('createdAt', filter.createdFrom) : undefined,
    filter.createdTo ? odata.le('createdAt', filter.createdTo) : undefined
  );
}

/** A fresh key per submission, so a repeated click or an automatic retry of
 *  the same submission cannot send twice. */
export function newIdempotencyKey(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `nk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
