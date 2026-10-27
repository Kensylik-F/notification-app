/**
 * Announcements this browser has dismissed. The service lists only
 * outstanding announcements and forgets them once their window ends, so the
 * only record of "what did I close" is the one the client keeps. Each entry
 * is the announcement exactly as the service sent it, plus when it was
 * dismissed here. Per browser and per `storageScope` (the signed-in user).
 */
import type { AnnouncementEntry } from '../core';

export interface DismissedAnnouncement {
  entry: AnnouncementEntry;
  dismissedAt: string;
}

const PREFIX = 'notifications-kit:dismissed-announcements:';
const LIMIT = 50;
const listeners = new Set<() => void>();

const keyFor = (scope: string) => `${PREFIX}${scope}`;

export function readDismissed(scope: string): DismissedAnnouncement[] {
  try {
    const raw = window.localStorage.getItem(keyFor(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as DismissedAnnouncement[]).filter(
          item => item && typeof item.entry?.id === 'string'
        )
      : [];
  } catch {
    return [];
  }
}

export function rememberDismissed(scope: string, entry: AnnouncementEntry) {
  try {
    const rest = readDismissed(scope).filter(
      item => item.entry.id !== entry.id
    );
    const next = [
      {
        entry: { ...entry, dismissed: true },
        dismissedAt: new Date().toISOString(),
      },
      ...rest,
    ].slice(0, LIMIT);
    window.localStorage.setItem(keyFor(scope), JSON.stringify(next));
    listeners.forEach(listener => listener());
  } catch {
    // Storage unavailable: the history simply has nothing to show.
  }
}

/** The service's current text of a closed announcement (after a
 *  correction): the closed list shows it, the closing time stays. */
export function refreshDismissed(scope: string, entry: AnnouncementEntry) {
  try {
    const items = readDismissed(scope);
    if (!items.some(item => item.entry.id === entry.id)) return;
    const next = items.map(item =>
      item.entry.id === entry.id
        ? { ...item, entry: { ...entry, dismissed: true } }
        : item
    );
    window.localStorage.setItem(keyFor(scope), JSON.stringify(next));
    listeners.forEach(listener => listener());
  } catch {
    // Storage unavailable: nothing to refresh.
  }
}

export function subscribeDismissed(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(PREFIX)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
