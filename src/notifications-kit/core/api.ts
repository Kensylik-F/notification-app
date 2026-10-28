import { createNotificationsClient } from './client';
import type { NotificationsClient, NotificationsClientOptions } from './client';
import type {
  AnnouncementAdmin,
  BatchSendRequest,
  ChangeAnnouncementWindowRequest,
  BatchSendResponse,
  DeliveryContentResponse,
  DeliveryResponse,
  DeliveryTransitionResponse,
  FilterMetadata,
  NotificationRequestResponse,
  OperationResponse,
  PageResponseDeliveryResponse,
  PublishAnnouncementRequest,
  RenderPreviewRequest,
  RenderPreviewResponse,
  SendNotificationRequest,
  ServerInfoResponse,
  SuppressionRequest,
  SuppressionResponse,
  WithdrawAnnouncementRequest,
} from './generated/schemas';
import { NotificationsError } from './errors';
import {
  toAnnouncementEntry,
  toAnnouncementPage,
  toInboxEntry,
  toInboxPage,
} from './model';
import type { AnnouncementEntry, InboxEntry, Page } from './model';
import { toODataQuery } from './odata';
import type { PageQuery } from './odata';
import type { OperationKey } from './generated/operations';

export type Channel = NonNullable<DeliveryResponse['channel']>;

interface CallOptions {
  signal?: AbortSignal;
}

export interface OperationPoll {
  operation: OperationResponse;
  /** The interval the service asks to wait before the next poll. Absent
   *  once the operation is terminal. */
  retryAfterMs: number | undefined;
}

function required<T>(value: T | null, operation: OperationKey): T {
  if (value === null) {
    throw new NotificationsError({
      kind: 'contract',
      operation,
      message: `${operation}: response carries no id`,
    });
  }
  return value;
}

/**
 * Every operation of the published contract, one method each. Paths, query
 * options and bodies come from the generated operation table; nothing here
 * spells a URL.
 */
export function createNotificationsApi(
  options: NotificationsClientOptions | { client: NotificationsClient }
) {
  const client =
    'client' in options ? options.client : createNotificationsClient(options);

  const inbox = {
    /** Newest first, dismissed excluded. Rows carry no subject or body. */
    async list(
      query: PageQuery = {},
      { signal }: CallOptions = {}
    ): Promise<Page<InboxEntry>> {
      const page = await client.call('GET /inbox', {
        query: toODataQuery(query),
        signal,
      });
      return toInboxPage(page, query.top);
    },

    async unreadCount({ signal }: CallOptions = {}): Promise<number> {
      const summary = await client.call('GET /inbox/unread-count', {
        signal,
      });
      return summary.unread ?? 0;
    },

    /** One item with its rendered subject and body. Does not mark it read. */
    async get(id: string, { signal }: CallOptions = {}): Promise<InboxEntry> {
      const key = 'GET /inbox/{id}';
      const item = await client.call(key, { path: { id }, signal });
      return required(toInboxEntry(item), key);
    },

    /** Shown in a list. Idempotent. */
    async markSeen(id: string): Promise<InboxEntry> {
      const key = 'POST /inbox/{id}/seen';
      const item = await client.call(key, { path: { id } });
      return required(toInboxEntry(item), key);
    },

    /** Opened. Also marks it seen. Idempotent. */
    async markRead(id: string): Promise<InboxEntry> {
      const key = 'POST /inbox/{id}/read';
      const item = await client.call(key, { path: { id } });
      return required(toInboxEntry(item), key);
    },

    /** Resolves to how many items moved; zero on a repeat. */
    async markAllRead(): Promise<number> {
      const summary = await client.call('POST /inbox/read', {});
      return summary.unread ?? 0;
    },

    /** Leaves the default list without being marked read. Idempotent. */
    async dismiss(id: string): Promise<InboxEntry> {
      const key = 'POST /inbox/{id}/dismiss';
      const item = await client.call(key, { path: { id } });
      return required(toInboxEntry(item), key);
    },
  };

  const announcements = {
    /** Newest first, dismissed excluded, only inside the visibility window. */
    async list(
      query: PageQuery = {},
      { signal }: CallOptions = {}
    ): Promise<Page<AnnouncementEntry>> {
      const page = await client.call('GET /announcements', {
        query: toODataQuery(query),
        signal,
      });
      return toAnnouncementPage(page, query.top);
    },

    async outstandingCount({ signal }: CallOptions = {}): Promise<number> {
      const summary = await client.call(
        'GET /announcements/outstanding-count',
        { signal }
      );
      return summary.outstanding ?? 0;
    },

    async get(
      id: string,
      { signal }: CallOptions = {}
    ): Promise<AnnouncementEntry> {
      const key = 'GET /announcements/{id}';
      const item = await client.call(key, { path: { id }, signal });
      return required(toAnnouncementEntry(item), key);
    },

    /** For this caller alone. Idempotent. */
    async dismiss(id: string): Promise<AnnouncementEntry> {
      const key = 'POST /announcements/{id}/dismiss';
      const item = await client.call(key, { path: { id } });
      return required(toAnnouncementEntry(item), key);
    },

    /** The category decides the class and the channels. Not idempotent. */
    publish: (body: PublishAnnouncementRequest): Promise<AnnouncementAdmin> =>
      client.call('POST /announcements', { body }),

    /** Content only; the window has `changeWindow`, the audience never
     *  changes. A withdrawn announcement answers 409. */
    correct: (
      id: string,
      body: PublishAnnouncementRequest
    ): Promise<AnnouncementAdmin> =>
      client.call('POST /announcements/{id}/corrections', {
        path: { id },
        body,
      }),

    /**
     * Replaces the window. The end cannot be in the past (422
     * `window-in-past`); the start moves only before the window opens (409
     * `window-opened`); a withdrawn announcement answers 409 `withdrawn`.
     */
    changeWindow: (
      id: string,
      body: ChangeAnnouncementWindowRequest
    ): Promise<AnnouncementAdmin> =>
      client.call('PUT /announcements/{id}/window', { path: { id }, body }),

    /**
     * Hides it from every recipient at once and cancels a running email
     * run. Final: nothing about it can change afterwards. Idempotent.
     */
    withdraw: (
      id: string,
      body: WithdrawAnnouncementRequest = {}
    ): Promise<AnnouncementAdmin> =>
      client.call('POST /announcements/{id}/withdrawal', {
        path: { id },
        body,
      }),

    async emailRun(
      id: string,
      { signal }: CallOptions = {}
    ): Promise<OperationPoll> {
      const result = await client.callWithMeta(
        'GET /announcements/{id}/email-run',
        { path: { id }, signal }
      );
      return { operation: result.data, retryAfterMs: result.retryAfterMs };
    },

    /** The stop is requested, not performed. Safe on a finished run. */
    cancelEmailRun: (id: string): Promise<OperationResponse> =>
      client.call('POST /announcements/{id}/email-run/cancellation', {
        path: { id },
      }),
  };

  const requests = {
    /** Pass `idempotencyKey` to make a retry of the same submission safe. */
    submit: (
      body: SendNotificationRequest,
      options: { idempotencyKey?: string } = {}
    ): Promise<NotificationRequestResponse> =>
      client.call('POST /notifications', {
        body,
        headers: { 'Idempotency-Key': options.idempotencyKey },
      }),

    /** Always answers 200; each item reports its own outcome. */
    submitBatch: (body: BatchSendRequest): Promise<BatchSendResponse> =>
      client.call('POST /notifications/batch', { body }),

    get: (
      id: string,
      { signal }: CallOptions = {}
    ): Promise<NotificationRequestResponse> =>
      client.call('GET /notifications/{id}', { path: { id }, signal }),

    /** Renders with the strictness of a live send. */
    preview: (body: RenderPreviewRequest): Promise<RenderPreviewResponse> =>
      client.call('POST /notifications/preview', { body }),
  };

  const deliveries = {
    search: (
      query: PageQuery = {},
      { signal }: CallOptions = {}
    ): Promise<PageResponseDeliveryResponse> =>
      client.call('GET /notifications/deliveries', {
        query: toODataQuery(query),
        signal,
      }),

    get: (
      id: string,
      { signal }: CallOptions = {}
    ): Promise<DeliveryResponse> =>
      client.call('GET /notifications/deliveries/{id}', {
        path: { id },
        signal,
      }),

    /** Every transition, oldest first. */
    history: (
      id: string,
      { signal }: CallOptions = {}
    ): Promise<DeliveryTransitionResponse[]> =>
      client.call('GET /notifications/deliveries/{id}/history', {
        path: { id },
        signal,
      }),

    /** Audited. 410 once the content retention window has passed. */
    content: (
      id: string,
      { signal }: CallOptions = {}
    ): Promise<DeliveryContentResponse> =>
      client.call('GET /notifications/deliveries/{id}/content', {
        path: { id },
        signal,
      }),

    /** Requeues a DEAD delivery and resets its attempt counter. */
    retry: (id: string): Promise<DeliveryResponse> =>
      client.call('POST /notifications/deliveries/{id}/retry', {
        path: { id },
      }),

    /** Only a delivery that has not been sent. */
    cancel: (id: string): Promise<DeliveryResponse> =>
      client.call('POST /notifications/deliveries/{id}/cancel', {
        path: { id },
      }),
  };

  const suppressions = {
    /** Addresses come back masked. */
    list: (
      channel: Channel,
      { signal }: CallOptions = {}
    ): Promise<SuppressionResponse[]> =>
      client.call('GET /notifications/suppressions', {
        query: { channel },
        signal,
      }),

    /** Omit `expiresAt` for a permanent suppression. */
    create: (body: SuppressionRequest): Promise<SuppressionResponse> =>
      client.call('POST /notifications/suppressions', { body }),

    release: (channel: Channel, address: string): Promise<void> =>
      client.call('DELETE /notifications/suppressions', {
        query: { channel, address },
      }),
  };

  return {
    client,
    inbox,
    announcements,
    requests,
    deliveries,
    suppressions,

    /** What `$filter` may name for an entity (see `FILTER_ENTITIES`). */
    filterMetadata: (
      entity: string,
      { signal }: CallOptions = {}
    ): Promise<FilterMetadata> =>
      client.call('GET /filter-metadata/{entity}', {
        path: { entity },
        signal,
      }),

    serverInfo: ({ signal }: CallOptions = {}): Promise<ServerInfoResponse> =>
      client.call('GET /server/info', { signal }),
  };
}

export type NotificationsApi = ReturnType<typeof createNotificationsApi>;
