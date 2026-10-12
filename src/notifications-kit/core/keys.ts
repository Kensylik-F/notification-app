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

  admin: () => [...notificationKeys.all, 'admin'] as const,
  deliveries: () => [...notificationKeys.admin(), 'deliveries'] as const,
  deliveryList: (query: PageQuery) =>
    [...notificationKeys.deliveries(), 'list', query] as const,
  delivery: (id: string) =>
    [...notificationKeys.deliveries(), 'item', id] as const,
  deliveryHistory: (id: string) =>
    [...notificationKeys.deliveries(), 'history', id] as const,
  deliveryContent: (id: string) =>
    [...notificationKeys.deliveries(), 'content', id] as const,
  request: (id: string) =>
    [...notificationKeys.admin(), 'request', id] as const,
  emailRun: (announcementId: string) =>
    [...notificationKeys.admin(), 'email-run', announcementId] as const,
  /** Announcements published from this browser session. */
  published: () => [...notificationKeys.admin(), 'published'] as const,
};
