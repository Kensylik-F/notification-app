/**
 * "Preview" in the administration forms plays the message out on this page
 * - a notification pops up and lands in the bell, an announcement takes its
 * place in the stack - without sending anything. The form puts what to show
 * here; the bell and the announcement overlays read it.
 */
import type { AnnouncementEntry, InboxEntry } from '../core';
import type { AnnouncementPresentation } from './presentation';

/** A notification as the service rendered it for the in-app channel. */
export interface InboxPreview {
  kind: 'inbox';
  /** A stand-in item with `id === PREVIEW_ID`. */
  entry: InboxEntry;
}

/** An announcement as it would be published, and how it would be shown. */
export interface AnnouncementPreview {
  kind: 'announcement';
  entry: AnnouncementEntry;
  presentation: AnnouncementPresentation;
}

export type KitPreview = InboxPreview | AnnouncementPreview;

export interface PreviewStore {
  get: () => KitPreview | null;
  set: (preview: KitPreview | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPreviewStore(): PreviewStore {
  let current: KitPreview | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: next => {
      if (next === current) return;
      current = next;
      listeners.forEach(listener => listener());
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Id given to the simulated items, so nothing mistakes them for real ones. */
export const PREVIEW_ID = 'notifications-kit:preview';
