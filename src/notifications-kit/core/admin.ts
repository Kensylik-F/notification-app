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

export type SendCategoryClass = SendNotificationRequest['categoryClass'];
export type SendPriority = SendNotificationRequest['priority'];
export type AudienceType = PublishAnnouncementRequest['audienceType'];
export type DeliveryStatus = NonNullable<DeliveryResponse['status']>;

/** `SendNotificationRequest.recipients` maxItems. */
export const MAX_RECIPIENTS = 500;
/** `ludwig.notification.announcements.max-visibility-window`. */
export const DEFAULT_MAX_VISIBILITY_DAYS = 90;
/** The order channels are offered in, everywhere. */
export const CHANNEL_ORDER: readonly Channel[] = [
  'EMAIL',
  'IN_APP',
  'CHAT',
  'WEBHOOK',
];

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

// ------------------------------------------------------------------ content

/**
 * What the message says. The contract has no body field: a send and a
 * publish carry a template key and its variables, nothing else.
 *
 * - `freeform` - text written in the editor, sent through the deployment's
 *   free-form template (`subject`, `bodyHtml`, `bodyText`; see
 *   service-templates/ in the kit's repository). Available only when the host
 *   names that template's key.
 * - `template` - any template the deployment has, by key, with variables
 *   typed as name/value pairs.
 */
export type MessageContent =
  | {
      mode: 'freeform';
      subject: string;
      /** Already cleaned by the editor. */
      bodyHtml: string;
      /** Plain-text twin of `bodyHtml`. */
      bodyText: string;
    }
  | { mode: 'template'; templateKey: string; variables: VariablePair[] };

export interface VariablePair {
  name: string;
  value: string;
}

/** Subject length the editor allows; the contract does not limit variables. */
export const MAX_SUBJECT_LENGTH = 200;

export type ContentErrors = Partial<
  Record<'subject' | 'body' | 'templateKey' | 'variables', string>
>;

export function validateContent(
  content: MessageContent,
  freeformTemplateKey: string | undefined
): ContentErrors {
  const errors: ContentErrors = {};
  if (content.mode === 'freeform') {
    if (!freeformTemplateKey) errors.body = 'unavailable';
    if (!content.subject.trim()) errors.subject = 'required';
    else if (content.subject.trim().length > MAX_SUBJECT_LENGTH) {
      errors.subject = 'tooLong';
    }
    if (!content.bodyText.trim()) errors.body ??= 'required';
    return errors;
  }
  const key = content.templateKey.trim();
  if (!key) errors.templateKey = 'required';
  else if (key.length > 128) errors.templateKey = 'tooLong';
  else if (!TEMPLATE_KEY_PATTERN.test(key)) errors.templateKey = 'pattern';
  const names = content.variables.map(pair => pair.name.trim()).filter(Boolean);
  if (new Set(names).size !== names.length) errors.variables = 'duplicate';
  else if (content.variables.some(p => !p.name.trim() && p.value.trim())) {
    errors.variables = 'unnamed';
  }
  return errors;
}

/** Template key and variables for the request. Empty values are left out:
 *  the renderer treats an absent optional variable correctly, an empty
 *  string it would print. */
export function contentToTemplate(
  content: MessageContent,
  freeformTemplateKey: string | undefined
): { templateKey: string; variables: Record<string, string> } {
  if (content.mode === 'freeform') {
    return {
      templateKey: freeformTemplateKey ?? '',
      variables: {
        subject: content.subject.trim(),
        bodyHtml: content.bodyHtml,
        bodyText: content.bodyText.trim(),
      },
    };
  }
  const variables: Record<string, string> = {};
  for (const pair of content.variables) {
    const name = pair.name.trim();
    if (name && pair.value.trim()) variables[name] = pair.value.trim();
  }
  return { templateKey: content.templateKey.trim(), variables };
}

// ---------------------------------------------------------------------- send

export interface SendDraft {
  content: MessageContent;
  channels: Channel[];
  category: string;
  categoryClass: SendCategoryClass;
  priority: SendPriority;
  recipients: RecipientDraft[];
  /** `null` - send now. */
  scheduledAt: string | null;
}

export type SendErrors = ContentErrors &
  Partial<
    Record<'channels' | 'category' | 'recipients' | 'scheduledAt', string>
  >;

/** Error codes, not text: the UI owns the wording. */
export function validateSend(
  draft: SendDraft,
  options: { freeformTemplateKey?: string; now?: number } = {}
): SendErrors {
  const now = options.now ?? Date.now();
  const errors: SendErrors = validateContent(
    draft.content,
    options.freeformTemplateKey
  );
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

export function buildSendRequest(
  draft: SendDraft,
  freeformTemplateKey?: string
): SendNotificationRequest {
  return {
    ...contentToTemplate(draft.content, freeformTemplateKey),
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
  content: MessageContent;
  /** `null` - visible from the moment of publishing. */
  visibleFrom: string | null;
  visibleUntil: string;
}

export type PublishErrors = ContentErrors &
  Partial<
    Record<'category' | 'audience' | 'visibleFrom' | 'visibleUntil', string>
  >;

export function validatePublish(
  draft: PublishDraft,
  options: {
    freeformTemplateKey?: string;
    maxVisibilityDays?: number;
    now?: number;
  } = {}
): PublishErrors {
  const now = options.now ?? Date.now();
  const maxDays = options.maxVisibilityDays ?? DEFAULT_MAX_VISIBILITY_DAYS;
  const errors: PublishErrors = validateContent(
    draft.content,
    options.freeformTemplateKey
  );

  if (!draft.category.trim()) errors.category = 'required';
  else if (draft.category.trim().length > 255) errors.category = 'tooLong';
  if (draft.audienceType === 'ROLE' && !draft.audienceValue.trim()) {
    errors.audience = 'required';
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
  draft: PublishDraft,
  freeformTemplateKey?: string
): PublishAnnouncementRequest {
  return {
    category: draft.category.trim(),
    audienceType: draft.audienceType,
    ...(draft.audienceType === 'ROLE'
      ? { audienceValue: draft.audienceValue.trim() }
      : {}),
    ...contentToTemplate(draft.content, freeformTemplateKey),
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
