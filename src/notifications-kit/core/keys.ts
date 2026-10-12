import type { PageQuery } from './odata';

/** Query keys of the kit. One root, so a host can invalidate everything the
 *  kit holds with a single call. */
export const notificationKeys = {
  all: ['notifications-kit'] as const,

  inbox: () => [...notificationKeys.all, 'inbox'] as const,
  inboxLists: () => [...notificationKeys.inbox(), 'list'] as const,
  inboxList: (query: PageQuery) =>
    [...notificationKeys.inboxLists(), query] as const,
  inboxItem: (id: string) => [...notificationKeys.inbox(), 'item', id] as const,
  unreadCount: () => [...notificationKeys.inbox(), 'unread-count'] as const,

  announcements: () => [...notificationKeys.all, 'announcements'] as const,
  announcementLists: () =>
    [...notificationKeys.announcements(), 'list'] as const,
  announcementList: (query: PageQuery) =>
    [...notificationKeys.announcementLists(), query] as const,
  announcement: (id: string) =>
    [...notificationKeys.announcements(), 'item', id] as const,
  outstandingCount: () =>
    [...notificationKeys.announcements(), 'outstanding-count'] as const,
};
