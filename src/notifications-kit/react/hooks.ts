import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  PAGE_LIMITS,
  isNotificationsError,
  mergeInboxEntry,
  notificationKeys,
  odata,
  retryDelay,
  shouldRetry,
} from '../core';
import type { AnnouncementEntry, InboxEntry, Page } from '../core';
import {
  asRead,
  asSeen,
  countsAsUnread,
  findEntry,
  flatten,
  patchAll,
  patchEntry,
  removeEntry,
} from './cache';
import type { InboxListData } from './cache';
import {
  readDismissed,
  rememberDismissed,
  subscribeDismissed,
} from './announcementHistory';
import type { DismissedAnnouncement } from './announcementHistory';
import { useNotificationsContext } from './context';

const retry = (failureCount: number, error: unknown) =>
  shouldRetry(failureCount, error);

/** The inbox commands are idempotent by contract, so one repeat is safe. */
const retryCommand = (failureCount: number, error: unknown) =>
  shouldRetry(failureCount, error, { maxRetries: 1 });

// ---------------------------------------------------------------- reading

/** The unread badge. Polled: the service has no push channel. */
export function useUnreadCount() {
  const { api, enabled, polling } = useNotificationsContext();
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: ({ signal }) => api.inbox.unreadCount({ signal }),
    enabled,
    refetchInterval: polling.unreadCountMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: Math.min(polling.unreadCountMs, 30_000),
    retry,
    retryDelay,
  });
}

/** `number` for a badge, `undefined` when there is nothing to show. Shaped
 *  for a navigation item's badge hook. */
export function useUnreadBadge(): number | undefined {
  const { data } = useUnreadCount();
  return data !== undefined && data > 0 ? data : undefined;
}

export interface InboxListOptions {
  unreadOnly?: boolean;
  pageSize?: number;
}

export function useInboxList(options: InboxListOptions = {}) {
  const { api, enabled } = useNotificationsContext();
  const pageSize = Math.min(
    options.pageSize ?? PAGE_LIMITS.DEFAULT_PAGE_SIZE,
    PAGE_LIMITS.MAX_PAGE_SIZE
  );
  const filter = options.unreadOnly ? odata.isNull('readAt') : undefined;

  const query = useInfiniteQuery({
    queryKey: notificationKeys.inboxList({ filter, top: pageSize }),
    queryFn: ({ pageParam, signal }) =>
      api.inbox.list({ filter, top: pageSize, skip: pageParam }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: Page<InboxEntry>,
      allPages: Page<InboxEntry>[]
    ) => {
      if (!lastPage.hasMore || lastPage.items.length === 0) return undefined;
      // A server that ignores $skip answers every page with the same rows;
      // asking again would only repeat them.
      const earlier = new Set(
        allPages.slice(0, -1).flatMap(page => page.items.map(e => e.id))
      );
      if (lastPage.items.every(entry => earlier.has(entry.id))) {
        return undefined;
      }
      return lastPage.offset + pageSize;
    },
    enabled,
    retry,
    retryDelay,
  });

  const entries = useMemo(() => flatten(query.data), [query.data]);
  const total = query.data?.pages[0]?.total ?? null;

  return { ...query, entries, total };
}

/** One item with its subject and body. Reading it does not mark it read. */
export function useInboxItem(id: string | undefined) {
  const { api, enabled } = useNotificationsContext();
  return useQuery({
    queryKey: notificationKeys.inboxItem(id ?? ''),
    queryFn: ({ signal }) => api.inbox.get(id as string, { signal }),
    enabled: enabled && id !== undefined && id !== '',
    // Content never changes; the flags are kept current by the commands.
    staleTime: Infinity,
    retry,
    retryDelay,
  });
}

/**
 * Subjects for list rows. A row arrives without one, so each visible row is
 * fetched by id once and kept; with `subjects: 'none'` nothing is fetched.
 */
export function useInboxSubjects(
  entries: readonly InboxEntry[]
): ReadonlyMap<string, InboxEntry> {
  return useInboxDetails(entries).items;
}

export interface InboxDetails {
  /** The item fetched by id, keyed by the id that was asked for. */
  items: ReadonlyMap<string, InboxEntry>;
  /** Failed by-id requests, by the same key. */
  errors: ReadonlyMap<string, unknown>;
}

/**
 * `useInboxSubjects` with the failures too. `alwaysFetch` lists ids that are
 * fetched even with `subjects: 'none'` - an expanded row needs its body.
 */
export function useInboxDetails(
  entries: readonly InboxEntry[],
  alwaysFetch: readonly string[] = []
): InboxDetails {
  const { api, enabled, subjects } = useNotificationsContext();
  const fetchAll = enabled && subjects === 'fetch';

  const ids = entries.map(entry => entry.id);
  const idsKey = ids.join('|');
  const forced = new Set(alwaysFetch);
  // Keyed by the id that was asked for, not the one in the answer: a row is
  // matched to its own request even if a server answers with another item.
  const combine = useCallback(
    (results: Array<{ data: InboxEntry | undefined; error: unknown }>) => {
      const keys = idsKey.split('|');
      const items = new Map<string, InboxEntry>();
      const errors = new Map<string, unknown>();
      results.forEach((result, index) => {
        const id = keys[index];
        if (!id) return;
        if (result.data) items.set(id, result.data);
        else if (result.error) errors.set(id, result.error);
      });
      return { items, errors };
    },
    [idsKey]
  );

  return useQueries({
    queries: ids.map(id => ({
      queryKey: notificationKeys.inboxItem(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.inbox.get(id, { signal }),
      enabled: fetchAll || (enabled && forced.has(id)),
      staleTime: Infinity,
      retry: false,
    })),
    combine,
  });
}

// --------------------------------------------------------------- commands

function listsOf(client: QueryClient) {
  return client.getQueriesData<InboxListData>({
    queryKey: notificationKeys.inboxLists(),
  });
}

function knownEntry(client: QueryClient, id: string): InboxEntry | undefined {
  const item = client.getQueryData<InboxEntry>(notificationKeys.inboxItem(id));
  if (item) return item;
  for (const [, data] of listsOf(client)) {
    const found = findEntry(data, id);
    if (found) return found;
  }
  return undefined;
}

function editLists(
  client: QueryClient,
  edit: (data: InboxListData | undefined) => InboxListData | undefined
) {
  client.setQueriesData<InboxListData>(
    { queryKey: notificationKeys.inboxLists() },
    edit
  );
}

function editItem(
  client: QueryClient,
  id: string,
  edit: (entry: InboxEntry) => InboxEntry
) {
  client.setQueryData<InboxEntry>(notificationKeys.inboxItem(id), entry =>
    entry ? edit(entry) : entry
  );
}

function lowerUnread(client: QueryClient, by: number) {
  client.setQueryData<number>(notificationKeys.unreadCount(), count =>
    count === undefined ? count : Math.max(0, count - by)
  );
}

/** Take the row the service answered with, keeping content already held. */
function acceptAnswer(client: QueryClient, answer: InboxEntry) {
  client.setQueryData<InboxEntry>(
    notificationKeys.inboxItem(answer.id),
    previous => mergeInboxEntry(previous, answer)
  );
  editLists(client, data =>
    patchEntry(data, answer.id, previous => mergeInboxEntry(previous, answer))
  );
}

export function useInboxCommands() {
  const { api, onError } = useNotificationsContext();
  const client = useQueryClient();

  const resync = (error: unknown) => {
    onError(error);
    void client.invalidateQueries({ queryKey: notificationKeys.inbox() });
  };
  const refreshCount = () =>
    void client.invalidateQueries({ queryKey: notificationKeys.unreadCount() });

  const markRead = useMutation({
    mutationFn: (id: string) => api.inbox.markRead(id),
    retry: retryCommand,
    retryDelay,
    onMutate: id => {
      const at = new Date().toISOString();
      if (countsAsUnread(knownEntry(client, id))) lowerUnread(client, 1);
      editItem(client, id, entry => asRead(entry, at));
      editLists(client, data => patchEntry(data, id, e => asRead(e, at)));
    },
    onSuccess: answer => {
      acceptAnswer(client, answer);
      refreshCount();
    },
    onError: resync,
  });

  const markSeen = useMutation({
    mutationFn: (id: string) => api.inbox.markSeen(id),
    retry: retryCommand,
    retryDelay,
    onMutate: id => {
      const at = new Date().toISOString();
      editItem(client, id, entry => asSeen(entry, at));
      editLists(client, data => patchEntry(data, id, e => asSeen(e, at)));
    },
    onSuccess: answer => acceptAnswer(client, answer),
    // Seen is bookkeeping: a failure is reported, never shown.
    onError,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.inbox.markAllRead(),
    retry: retryCommand,
    retryDelay,
    onMutate: () => {
      const at = new Date().toISOString();
      client.setQueryData<number>(notificationKeys.unreadCount(), count =>
        count === undefined ? count : 0
      );
      editLists(client, data => patchAll(data, e => asRead(e, at)));
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: notificationKeys.inbox() });
    },
    onError: resync,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.inbox.dismiss(id),
    retry: retryCommand,
    retryDelay,
    onMutate: id => {
      if (countsAsUnread(knownEntry(client, id))) lowerUnread(client, 1);
      editLists(client, data => removeEntry(data, id));
    },
    onSuccess: answer => {
      client.setQueryData<InboxEntry>(
        notificationKeys.inboxItem(answer.id),
        previous => mergeInboxEntry(previous, answer)
      );
      // Offsets behind the removed row have shifted by one.
      void client.invalidateQueries({
        queryKey: notificationKeys.inboxLists(),
        refetchType: 'none',
      });
      refreshCount();
    },
    onError: resync,
  });

  return { markRead, markSeen, markAllRead, dismiss };
}

// ------------------------------------------------------------- dismiss all

const DISMISS_PAGE = PAGE_LIMITS.MAX_PAGE_SIZE;
const DISMISS_CONCURRENCY = 4;
const DISMISS_MAX_ROUNDS = 200;

export interface DismissAllProgress {
  done: number;
  failed: number;
  /** From the first page; `null` when the service sent no total. */
  total: number | null;
  running: boolean;
}

/**
 * "Dismiss everything". The contract has no bulk dismiss, so this walks the
 * list and dismisses item by item, a few at a time. Dismissed items leave
 * the list, so it always reads the first page again; an item seen once is
 * never sent twice, which also ends the walk against a server that ignores
 * paging. Can be stopped; what was dismissed stays dismissed.
 */
export function useDismissAll() {
  const { api, onError } = useNotificationsContext();
  const client = useQueryClient();
  const [progress, setProgress] = useState<DismissAllProgress | null>(null);
  const stopRef = useRef(false);

  const start = useCallback(async () => {
    stopRef.current = false;
    const seen = new Set<string>();
    let done = 0;
    let failed = 0;
    let total: number | null = null;
    const report = (running: boolean) =>
      setProgress({ done, failed, total, running });
    report(true);

    const dismissOne = async (id: string) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await api.inbox.dismiss(id);
          done += 1;
          return;
        } catch (error) {
          if (!shouldRetry(attempt, error, { maxRetries: 1 })) {
            failed += 1;
            onError(error);
            return;
          }
          await new Promise(r => setTimeout(r, retryDelay(attempt, error)));
        }
      }
    };

    try {
      for (let round = 0; round < DISMISS_MAX_ROUNDS; round += 1) {
        if (stopRef.current) break;
        const page = await api.inbox.list({ top: DISMISS_PAGE, skip: 0 });
        if (round === 0) total = page.total;
        const fresh = page.items.filter(entry => !seen.has(entry.id));
        if (fresh.length === 0) break;
        fresh.forEach(entry => seen.add(entry.id));
        for (let i = 0; i < fresh.length; i += DISMISS_CONCURRENCY) {
          if (stopRef.current) break;
          await Promise.all(
            fresh.slice(i, i + DISMISS_CONCURRENCY).map(e => dismissOne(e.id))
          );
          report(true);
        }
      }
    } catch (error) {
      onError(error);
      failed += 1;
    } finally {
      report(false);
      void client.invalidateQueries({ queryKey: notificationKeys.inbox() });
    }
  }, [api, client, onError]);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);
  const reset = useCallback(() => setProgress(null), []);

  return { progress, start, stop, reset };
}

// ----------------------------------------------------------- announcements

type AnnouncementPage = Page<AnnouncementEntry>;

/** The caller's outstanding announcements, newest first. */
export function useAnnouncements(options: { pageSize?: number } = {}) {
  const { api, enabled, polling } = useNotificationsContext();
  const top = Math.min(options.pageSize ?? 20, PAGE_LIMITS.MAX_PAGE_SIZE);
  return useQuery({
    queryKey: notificationKeys.announcementList({ top }),
    queryFn: ({ signal }) => api.announcements.list({ top }, { signal }),
    enabled,
    refetchInterval: polling.announcementsMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: Math.min(polling.announcementsMs, 60_000),
    retry,
    retryDelay,
  });
}

export function useOutstandingAnnouncementCount() {
  const { api, enabled, polling } = useNotificationsContext();
  return useQuery({
    queryKey: notificationKeys.outstandingCount(),
    queryFn: ({ signal }) => api.announcements.outstandingCount({ signal }),
    enabled,
    refetchInterval: polling.announcementsMs,
    refetchIntervalInBackground: false,
    retry,
    retryDelay,
  });
}

/** Dismisses for this caller alone. Idempotent, so it is safe to repeat.
 *  The announcement is also remembered in this browser's history. */
export function useDismissAnnouncement() {
  const { api, onError, storageScope } = useNotificationsContext();
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.announcements.dismiss(id),
    retry: retryCommand,
    retryDelay,
    onMutate: id => {
      let known: AnnouncementEntry | undefined;
      client
        .getQueriesData<AnnouncementPage>({
          queryKey: notificationKeys.announcementLists(),
        })
        .forEach(([, page]) => {
          known ??= page?.items.find(entry => entry.id === id);
        });
      if (known) rememberDismissed(storageScope, known);
      client.setQueriesData<AnnouncementPage>(
        { queryKey: notificationKeys.announcementLists() },
        page =>
          page
            ? {
                ...page,
                items: page.items.filter(entry => entry.id !== id),
                total: page.total === null ? null : Math.max(0, page.total - 1),
              }
            : page
      );
      client.setQueryData<number>(notificationKeys.outstandingCount(), count =>
        count === undefined ? count : Math.max(0, count - 1)
      );
    },
    onSuccess: answer => {
      // The service's own answer is the better record.
      rememberDismissed(storageScope, answer);
      client.setQueryData(notificationKeys.announcement(answer.id), answer);
    },
    onError: error => {
      onError(error);
      void client.invalidateQueries({
        queryKey: notificationKeys.announcements(),
      });
    },
  });
}

/** The history of announcements dismissed in this browser, newest first. */
export function useDismissedAnnouncements(): DismissedAnnouncement[] {
  const { storageScope } = useNotificationsContext();
  const [items, setItems] = useState(() =>
    typeof window === 'undefined' ? [] : readDismissed(storageScope)
  );
  useEffect(() => {
    setItems(readDismissed(storageScope));
    return subscribeDismissed(() => setItems(readDismissed(storageScope)));
  }, [storageScope]);
  return items;
}

/** One announcement by id. Answers 404 once its window has ended. */
export function useAnnouncement(id: string | undefined) {
  const { api, enabled } = useNotificationsContext();
  return useQuery({
    queryKey: notificationKeys.announcement(id ?? ''),
    queryFn: ({ signal }) => api.announcements.get(id as string, { signal }),
    enabled: enabled && Boolean(id),
    staleTime: 60_000,
    retry: (count, error) =>
      !(isNotificationsError(error) && error.status === 404) &&
      retry(count, error),
    retryDelay,
  });
}
