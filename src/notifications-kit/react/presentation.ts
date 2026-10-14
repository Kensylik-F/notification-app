import type { AnnouncementEntry, CategoryClass } from '../core';

/**
 * How one announcement is shown. The service publishes WHAT an announcement
 * is (`category`, `categoryClass`) and has no field for how to show it, so
 * the mapping is the host's configuration.
 *
 * - `modal`  - a dialog in the middle of the window; "Got it" closes it;
 * - `toast`  - a strip at the top centre until its close button is used;
 * - `corner` - a card in the deck in the top-right corner;
 * - `none`   - not shown over the page (still in the bell and on the page).
 */
export type AnnouncementPresentation = 'modal' | 'corner' | 'toast' | 'none';

export type PresentationResolver = (
  announcement: AnnouncementEntry
) => AnnouncementPresentation;

/** The default: important things in the middle, the platform's own news at
 *  the top, product news in the corner. */
export const CLASS_PRESENTATION: Readonly<
  Record<CategoryClass, AnnouncementPresentation>
> = {
  TRANSACTIONAL: 'modal',
  PLATFORM: 'toast',
  MARKETING: 'corner',
};

/** Resolve by the announcement's `categoryClass`, with a fallback for an
 *  announcement without one. */
export function presentationByClass(
  byClass: Partial<
    Record<CategoryClass, AnnouncementPresentation>
  > = CLASS_PRESENTATION,
  fallback: AnnouncementPresentation = 'corner'
): PresentationResolver {
  return announcement =>
    (announcement.categoryClass !== null
      ? byClass[announcement.categoryClass]
      : undefined) ?? fallback;
}

/** Resolve by the announcement's `category`; anything not listed goes by
 *  `otherwise` (by class, unless given). */
export function presentationByCategory(
  byCategory: Readonly<Record<string, AnnouncementPresentation>>,
  otherwise:
    | AnnouncementPresentation
    | PresentationResolver = presentationByClass()
): PresentationResolver {
  const rest = typeof otherwise === 'function' ? otherwise : () => otherwise;
  return announcement =>
    (announcement.category !== null
      ? byCategory[announcement.category]
      : undefined) ?? rest(announcement);
}

export const defaultPresentation: PresentationResolver = presentationByClass();

/** TRANSACTIONAL first, then PLATFORM, then MARKETING and the rest. */
export function classRank(entry: Pick<AnnouncementEntry, 'categoryClass'>) {
  switch (entry.categoryClass) {
    case 'TRANSACTIONAL':
      return 0;
    case 'PLATFORM':
      return 1;
    default:
      return 2;
  }
}

/** Shown in red with an "Important" label. */
export const isImportant = (entry: Pick<AnnouncementEntry, 'categoryClass'>) =>
  entry.categoryClass === 'TRANSACTIONAL';

const time = (value: string | null) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** For lists (the bell, the page): the most important first, newest first
 *  within a class. */
export function byPriority(
  entries: readonly AnnouncementEntry[]
): AnnouncementEntry[] {
  return [...entries].sort(
    (a, b) =>
      classRank(a) - classRank(b) || time(b.publishedAt) - time(a.publishedAt)
  );
}

export interface AnnouncementQueue {
  /** Dialogs, oldest first: shown one at a time. */
  modal: AnnouncementEntry[];
  /** Strips, oldest first: shown one at a time, after the dialogs. */
  toast: AnnouncementEntry[];
  /** The deck, newest first: shown last, all together. */
  corner: AnnouncementEntry[];
}

export interface QueueOptions {
  resolve: PresentationResolver;
  /** Ids on their way out (a dismissal in flight). */
  hidden: ReadonlySet<string>;
  now: number;
}

function insideWindow(entry: AnnouncementEntry, now: number): boolean {
  const from = entry.visibleFrom ? Date.parse(entry.visibleFrom) : NaN;
  const until = entry.visibleUntil ? Date.parse(entry.visibleUntil) : NaN;
  if (!Number.isNaN(from) && now < from) return false;
  if (!Number.isNaN(until) && now >= until) return false;
  return true;
}

/**
 * Splits the caller's outstanding announcements into the three queues. A
 * dialog and a strip are read in the order they were published, so those
 * queues run oldest first; the deck shows the newest on top.
 */
export function queueAnnouncements(
  entries: readonly AnnouncementEntry[],
  options: QueueOptions
): AnnouncementQueue {
  const queue: AnnouncementQueue = { modal: [], toast: [], corner: [] };
  for (const entry of entries) {
    if (entry.dismissed || options.hidden.has(entry.id)) continue;
    // The service already filters by window; a page cached across the end
    // of one must not keep showing it.
    if (!insideWindow(entry, options.now)) continue;
    const where = options.resolve(entry);
    if (where !== 'none') queue[where].push(entry);
  }
  const oldest = (a: AnnouncementEntry, b: AnnouncementEntry) =>
    time(a.publishedAt) - time(b.publishedAt);
  queue.modal.sort(oldest);
  queue.toast.sort(oldest);
  queue.corner.sort((a, b) => oldest(b, a));
  return queue;
}
