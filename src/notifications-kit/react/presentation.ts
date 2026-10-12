import type { AnnouncementEntry } from '../core';

/**
 * How one announcement is shown. The service publishes WHAT an announcement
 * is (`category`, `categoryClass`) and has no field for how to show it, so
 * the mapping is the host's configuration.
 *
 * - `modal`  - blocks the page until acknowledged; acknowledging dismisses;
 * - `corner` - a small card in the corner until its close button is used;
 * - `toast`  - appears for a few seconds, then gets out of the way;
 * - `none`   - not shown as an overlay (still available through the hooks).
 */
export type AnnouncementPresentation = 'modal' | 'corner' | 'toast' | 'none';

export type PresentationResolver = (
  announcement: AnnouncementEntry
) => AnnouncementPresentation;

/** Resolve by the announcement's `category`, with a fallback. */
export function presentationByCategory(
  byCategory: Readonly<Record<string, AnnouncementPresentation>>,
  fallback: AnnouncementPresentation = 'corner'
): PresentationResolver {
  return announcement =>
    (announcement.category !== null
      ? byCategory[announcement.category]
      : undefined) ?? fallback;
}

export const defaultPresentation: PresentationResolver = () => 'corner';

export interface AnnouncementPlan {
  /** At most one: a second modal waits for the first to be acknowledged. */
  modal: AnnouncementEntry | null;
  corner: AnnouncementEntry[];
  toasts: AnnouncementEntry[];
}

export interface PlanOptions {
  resolve: PresentationResolver;
  /** Ids already handled in this session (hidden toasts, pending dismissals). */
  hidden: ReadonlySet<string>;
  maxCorner: number;
  maxToasts: number;
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
 * Splits the caller's outstanding announcements across the three overlays.
 * The feed arrives newest first; a modal is taken OLDEST first so that a
 * queue of them is read in the order it was published.
 */
export function planAnnouncements(
  entries: readonly AnnouncementEntry[],
  options: PlanOptions
): AnnouncementPlan {
  const plan: AnnouncementPlan = { modal: null, corner: [], toasts: [] };
  const modals: AnnouncementEntry[] = [];

  for (const entry of entries) {
    if (entry.dismissed || options.hidden.has(entry.id)) continue;
    // The service already filters by window; a page cached across the end
    // of one must not keep showing it.
    if (!insideWindow(entry, options.now)) continue;

    switch (options.resolve(entry)) {
      case 'modal':
        modals.push(entry);
        break;
      case 'corner':
        if (plan.corner.length < options.maxCorner) plan.corner.push(entry);
        break;
      case 'toast':
        if (plan.toasts.length < options.maxToasts) plan.toasts.push(entry);
        break;
      case 'none':
        break;
    }
  }

  plan.modal = modals[modals.length - 1] ?? null;
  return plan;
}
