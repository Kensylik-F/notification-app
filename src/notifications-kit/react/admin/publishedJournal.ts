/**
 * Announcements published from this browser, with what was sent.
 *
 * The service keeps the rendered text of an announcement, not the template
 * variables it was rendered from, and it has no "everything I published"
 * list. For an announcement made from a service template the variables
 * exist nowhere else, and a correction must send them all again. So the
 * publisher remembers the request it sent (and the latest correction) per
 * browser and per `storageScope` (the signed-in user).
 */
import type { AnnouncementAdmin, PublishAnnouncementRequest } from '../../core';

export interface PublishedRecord {
  id: string;
  /** The request as last sent: the publish, then each correction. */
  request: PublishAnnouncementRequest;
  announcement: AnnouncementAdmin;
  publishedAt: string;
  correctedAt?: string;
}

const PREFIX = 'notifications-kit:published-announcements:';
const LIMIT = 100;
const listeners = new Set<() => void>();

const keyFor = (scope: string) => `${PREFIX}${scope}`;

export function readPublished(scope: string): PublishedRecord[] {
  try {
    const raw = window.localStorage.getItem(keyFor(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as PublishedRecord[]).filter(
          item => item && typeof item.id === 'string' && item.request
        )
      : [];
  } catch {
    return [];
  }
}

function write(scope: string, records: PublishedRecord[]) {
  try {
    window.localStorage.setItem(
      keyFor(scope),
      JSON.stringify(records.slice(0, LIMIT))
    );
    listeners.forEach(listener => listener());
  } catch {
    // Storage unavailable: the list falls back to what the service lists.
  }
}

export function rememberPublished(
  scope: string,
  announcement: AnnouncementAdmin,
  request: PublishAnnouncementRequest
) {
  if (!announcement.id) return;
  const id = announcement.id;
  write(scope, [
    {
      id,
      request,
      announcement,
      publishedAt: announcement.publishedAt ?? new Date().toISOString(),
    },
    ...readPublished(scope).filter(record => record.id !== id),
  ]);
}

export function rememberCorrection(
  scope: string,
  id: string,
  request: PublishAnnouncementRequest
) {
  const records = readPublished(scope);
  if (!records.some(record => record.id === id)) return;
  write(
    scope,
    records.map(record =>
      record.id === id
        ? { ...record, request, correctedAt: new Date().toISOString() }
        : record
    )
  );
}

export function subscribePublished(listener: () => void): () => void {
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

/** The service's answer to a change (window, withdrawal): the record
 *  keeps its dates and its withdrawal. */
export function rememberAdmin(
  scope: string,
  id: string,
  admin: AnnouncementAdmin
) {
  const records = readPublished(scope);
  if (!records.some(record => record.id === id)) return;
  write(
    scope,
    records.map(record =>
      record.id === id
        ? {
            ...record,
            announcement: { ...record.announcement, ...admin },
            request: {
              ...record.request,
              ...(admin.visibleFrom ? { visibleFrom: admin.visibleFrom } : {}),
              ...(admin.visibleUntil
                ? { visibleUntil: admin.visibleUntil }
                : {}),
            },
            correctedAt: new Date().toISOString(),
          }
        : record
    )
  );
}
