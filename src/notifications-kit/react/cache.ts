import type { InfiniteData } from '@tanstack/react-query';

import type { InboxEntry, Page } from '../core';

/**
 * Pure edits of what the kit holds in the query cache. The inbox commands
 * are idempotent and answer with the updated row, so the cache can be moved
 * forward immediately and corrected from the answer.
 */

export type InboxListData = InfiniteData<Page<InboxEntry>>;

export function patchEntry(
  data: InboxListData | undefined,
  id: string,
  patch: (entry: InboxEntry) => InboxEntry
): InboxListData | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map(page => {
    const index = page.items.findIndex(entry => entry.id === id);
    if (index === -1) return page;
    changed = true;
    const items = page.items.slice();
    items[index] = patch(items[index] as InboxEntry);
    return { ...page, items };
  });
  return changed ? { ...data, pages } : data;
}

export function removeEntry(
  data: InboxListData | undefined,
  id: string
): InboxListData | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map(page => {
    if (!page.items.some(entry => entry.id === id)) return page;
    changed = true;
    return {
      ...page,
      items: page.items.filter(entry => entry.id !== id),
      total: page.total === null ? null : Math.max(0, page.total - 1),
    };
  });
  return changed ? { ...data, pages } : data;
}

export function patchAll(
  data: InboxListData | undefined,
  patch: (entry: InboxEntry) => InboxEntry
): InboxListData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map(page => ({ ...page, items: page.items.map(patch) })),
  };
}

export function findEntry(
  data: InboxListData | undefined,
  id: string
): InboxEntry | undefined {
  for (const page of data?.pages ?? []) {
    const found = page.items.find(entry => entry.id === id);
    if (found) return found;
  }
  return undefined;
}

export const asRead = (entry: InboxEntry, at: string): InboxEntry =>
  entry.read
    ? entry
    : {
        ...entry,
        read: true,
        readAt: at,
        seen: true,
        seenAt: entry.seenAt ?? at,
      };

export const asSeen = (entry: InboxEntry, at: string): InboxEntry =>
  entry.seen ? entry : { ...entry, seen: true, seenAt: at };

/** Dismissed items do not count as unread, so both commands lower it. */
export const countsAsUnread = (entry: InboxEntry | undefined): boolean =>
  entry !== undefined && !entry.read && !entry.dismissed;

export const flatten = (data: InboxListData | undefined): InboxEntry[] =>
  data?.pages.flatMap(page => page.items) ?? [];
