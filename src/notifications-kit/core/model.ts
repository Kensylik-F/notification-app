import type {
  Announcement,
  InboxItem,
  PageResponseAnnouncement,
  PageResponseInboxItem,
} from './generated/schemas';

/**
 * The published schemas mark no response member as required, so the wire
 * types are optional throughout. The entries below are what the rest of the
 * kit works with: absent members become `null`, the derived flags become
 * booleans, and a row without an `id` is not an entry at all.
 */

export type CategoryClass = NonNullable<InboxItem['categoryClass']>;
export type Priority = NonNullable<InboxItem['priority']>;

export interface InboxEntry {
  id: string;
  /** The notification catalogue key this was rendered from. */
  templateKey: string | null;
  category: string | null;
  categoryClass: CategoryClass | null;
  priority: Priority | null;
  locale: string | null;
  /** `null` on a list and on the answer to a transition; present when one
   *  item is fetched. */
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  createdAt: string | null;
  /** Shown in a list - not the same as opened. */
  seenAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  seen: boolean;
  read: boolean;
  dismissed: boolean;
}

export interface AnnouncementEntry {
  id: string;
  category: string | null;
  categoryClass: CategoryClass | null;
  locale: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  publishedAt: string | null;
  visibleFrom: string | null;
  visibleUntil: string | null;
  dismissed: boolean;
}

export interface Page<T> {
  items: T[];
  /** The offset the service applied. */
  offset: number;
  /** `null` when the request asked for `$count=false`. */
  total: number | null;
  hasMore: boolean;
}

export function toInboxEntry(item: InboxItem): InboxEntry | null {
  if (!item.id) return null;
  const readAt = item.readAt ?? null;
  const seenAt = item.seenAt ?? null;
  const dismissedAt = item.dismissedAt ?? null;
  return {
    id: item.id,
    templateKey: item.templateKey ?? null,
    category: item.category ?? null,
    categoryClass: item.categoryClass ?? null,
    priority: item.priority ?? null,
    locale: item.locale ?? null,
    subject: item.subject ?? null,
    bodyText: item.bodyText ?? null,
    bodyHtml: item.bodyHtml ?? null,
    createdAt: item.createdAt ?? null,
    seenAt,
    readAt,
    dismissedAt,
    seen: seenAt !== null,
    read: item.read ?? readAt !== null,
    dismissed: item.dismissed ?? dismissedAt !== null,
  };
}

export function toAnnouncementEntry(
  item: Announcement
): AnnouncementEntry | null {
  if (!item.id) return null;
  return {
    id: item.id,
    category: item.category ?? null,
    categoryClass: item.categoryClass ?? null,
    locale: item.locale ?? null,
    subject: item.subject ?? null,
    bodyText: item.bodyText ?? null,
    bodyHtml: item.bodyHtml ?? null,
    publishedAt: item.publishedAt ?? null,
    visibleFrom: item.visibleFrom ?? null,
    visibleUntil: item.visibleUntil ?? null,
    dismissed: item.dismissed ?? false,
  };
}

function toPage<W, T>(
  page: {
    content?: W[] | null;
    offset?: number | null;
    totalElements?: number | null;
  },
  convert: (item: W) => T | null,
  requestedTop: number | undefined
): Page<T> {
  const content = page.content ?? [];
  const items = content
    .map(convert)
    .filter((entry): entry is T => entry !== null);
  const offset = page.offset ?? 0;
  const total = page.totalElements ?? null;
  // A page shorter than asked for is the last one, whatever the total says.
  const shortPage = requestedTop !== undefined && content.length < requestedTop;
  const hasMore =
    !shortPage &&
    (total !== null
      ? offset + content.length < total
      : requestedTop !== undefined);
  return { items, offset, total, hasMore };
}

export const toInboxPage = (
  page: PageResponseInboxItem,
  requestedTop?: number
): Page<InboxEntry> => toPage(page, toInboxEntry, requestedTop);

export const toAnnouncementPage = (
  page: PageResponseAnnouncement,
  requestedTop?: number
): Page<AnnouncementEntry> => toPage(page, toAnnouncementEntry, requestedTop);

/**
 * A transition (`seen`, `read`, `dismiss`) answers without the content, so
 * its result must not erase a subject and body already held for that item.
 */
export function mergeInboxEntry(
  previous: InboxEntry | undefined,
  next: InboxEntry
): InboxEntry {
  if (!previous || previous.id !== next.id) return next;
  return {
    ...next,
    subject: next.subject ?? previous.subject,
    bodyText: next.bodyText ?? previous.bodyText,
    bodyHtml: next.bodyHtml ?? previous.bodyHtml,
  };
}
