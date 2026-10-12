import { describe, expect, it } from 'vitest';

import {
  IDEMPOTENT_COMMANDS,
  InboxItemSchema,
  NotificationsError,
  OPERATIONS,
  PageResponseInboxItemSchema,
  PublishAnnouncementRequestSchema,
  SendNotificationRequestSchema,
  createNotificationsApi,
  createNotificationsClient,
  isRetryable,
  mergeInboxEntry,
  odata,
  odataString,
  parseRetryAfter,
  retryDelay,
  shouldRetry,
  toInboxEntry,
  toInboxPage,
  toQueryString,
} from './index';
import type {
  NotificationsTransport,
  TransportRequest,
  TransportResponse,
} from './index';

const ID = '7c3f1c2e-8a54-4d0b-9f0e-3b1d2a4c5e6f';

function fakeTransport(
  respond: (request: TransportRequest) => Partial<TransportResponse>
) {
  const requests: TransportRequest[] = [];
  const transport: NotificationsTransport = async request => {
    requests.push(request);
    return { status: 200, headers: {}, data: undefined, ...respond(request) };
  };
  return { transport, requests };
}

describe('operation table', () => {
  it('never sends the springdoc `options` artefact', () => {
    for (const operation of Object.values(OPERATIONS)) {
      expect(operation.queryParams).not.toContain('options');
    }
  });

  it('exposes the five OData options on every paged feed', () => {
    for (const key of [
      'GET /api/v1/inbox',
      'GET /api/v1/announcements',
      'GET /api/v1/notifications/deliveries',
    ] as const) {
      expect(OPERATIONS[key].queryParams).toEqual([
        '$filter',
        '$orderby',
        '$top',
        '$skip',
        '$count',
      ]);
    }
  });

  it('marks only contract-declared idempotent commands as repeatable', () => {
    for (const key of IDEMPOTENT_COMMANDS) {
      expect(OPERATIONS[key].method).toBe('POST');
    }
    expect(IDEMPOTENT_COMMANDS.has('POST /api/v1/announcements')).toBe(false);
    expect(IDEMPOTENT_COMMANDS.has('POST /api/v1/notifications')).toBe(false);
  });
});

describe('wire schemas', () => {
  it('accepts the list row from the service README (no subject, no body)', () => {
    const page = PageResponseInboxItemSchema.parse({
      content: [
        {
          id: ID,
          category: 'account',
          createdAt: '2026-10-09T09:12:04Z',
          read: false,
        },
      ],
      offset: 0,
      size: 1,
      totalElements: 3,
    });
    expect(page.content?.[0]?.subject).toBeUndefined();
  });

  it.each([
    '2026-10-09T09:12:04Z',
    '2026-10-09T09:12:04.123456789Z',
    '2026-10-09T12:12:04+03:00',
  ])('accepts the instant %s', instant => {
    expect(
      InboxItemSchema.safeParse({ id: ID, createdAt: instant }).success
    ).toBe(true);
  });

  it('accepts explicit nulls for members absent from a projection', () => {
    const parsed = InboxItemSchema.safeParse({
      id: ID,
      subject: null,
      bodyHtml: null,
      bodyText: null,
      readAt: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a value outside a published enum', () => {
    expect(
      InboxItemSchema.safeParse({ id: ID, priority: 'URGENT' }).success
    ).toBe(false);
  });

  it('enforces request constraints from the contract', () => {
    const base = {
      audienceType: 'EVERYONE',
      category: 'platform-release',
      templateKey: 'platform-release',
      visibleUntil: '2026-11-10T08:00:00Z',
    };
    expect(PublishAnnouncementRequestSchema.safeParse(base).success).toBe(true);
    expect(
      PublishAnnouncementRequestSchema.safeParse({
        ...base,
        templateKey: 'Platform Release',
      }).success
    ).toBe(false);
    expect(
      PublishAnnouncementRequestSchema.safeParse({
        ...base,
        visibleUntil: undefined,
      }).success
    ).toBe(false);
  });

  it('requires unique channels on a send request', () => {
    const request = {
      category: 'security',
      categoryClass: 'TRANSACTIONAL',
      channels: ['IN_APP', 'IN_APP'],
      priority: 'HIGH',
      recipients: [{ userId: 'u1' }],
      templateKey: 'security.alert',
    };
    expect(SendNotificationRequestSchema.safeParse(request).success).toBe(
      false
    );
    expect(
      SendNotificationRequestSchema.safeParse({
        ...request,
        channels: ['IN_APP'],
      }).success
    ).toBe(true);
  });
});

describe('client', () => {
  it('substitutes and encodes path parameters', async () => {
    const { transport, requests } = fakeTransport(() => ({ data: { id: ID } }));
    const client = createNotificationsClient({ transport });
    await client.call('POST /api/v1/inbox/{id}/read', { path: { id: ID } });
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.path).toBe(`/api/v1/inbox/${ID}/read`);
    expect(requests[0]?.body).toBeUndefined();
  });

  it('sends OData options under their literal names, in contract order', async () => {
    const { transport, requests } = fakeTransport(() => ({
      data: { content: [] },
    }));
    const api = createNotificationsApi({ transport });
    await api.inbox.list({ filter: odata.isNull('readAt'), top: 10, skip: 20 });
    expect(requests[0]?.query).toEqual([
      ['$filter', 'readAt eq null'],
      ['$top', '10'],
      ['$skip', '20'],
    ]);
    expect(toQueryString(requests[0]?.query ?? [])).toBe(
      '$filter=readAt%20eq%20null&$top=10&$skip=20'
    );
  });

  it('sends Accept-Language and the Idempotency-Key header', async () => {
    const { transport, requests } = fakeTransport(() => ({ data: { id: ID } }));
    const api = createNotificationsApi({
      transport,
      acceptLanguage: () => 'ru',
    });
    await api.requests.submit(
      {
        category: 'security',
        categoryClass: 'TRANSACTIONAL',
        channels: ['IN_APP'],
        priority: 'HIGH',
        recipients: [{ userId: 'u1' }],
        templateKey: 'security.alert',
      },
      { idempotencyKey: 'k-1' }
    );
    expect(requests[0]?.headers['Accept-Language']).toBe('ru');
    expect(requests[0]?.headers['Idempotency-Key']).toBe('k-1');
  });

  it('turns a problem document into an error carrying its stable code', async () => {
    const { transport } = fakeTransport(() => ({
      status: 404,
      headers: { 'Content-Type': 'application/problem+json' },
      data: {
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'error.notification.inbox.not-found',
        detail: 'Notification not found',
        traceId: 'abc',
      },
    }));
    const api = createNotificationsApi({ transport });
    const error = await api.inbox.get(ID).catch(e => e);
    expect(error).toBeInstanceOf(NotificationsError);
    expect(error.kind).toBe('problem');
    expect(error.status).toBe(404);
    expect(error.code).toBe('error.notification.inbox.not-found');
    expect(error.traceId).toBe('abc');
    expect(isRetryable(error)).toBe(false);
  });

  it('keeps the status when an error body is not a problem document', async () => {
    const { transport } = fakeTransport(() => ({
      status: 503,
      headers: { 'Retry-After': '7' },
      data: '<html>upstream</html>',
    }));
    const api = createNotificationsApi({ transport });
    const error = await api.inbox.unreadCount().catch(e => e);
    expect(error.status).toBe(503);
    expect(error.code).toBeUndefined();
    expect(error.retryAfterMs).toBe(7000);
    expect(isRetryable(error)).toBe(true);
  });

  it('reports a 2xx body that breaks the contract as a contract error', async () => {
    const { transport } = fakeTransport(() => ({ data: { unread: 'three' } }));
    const api = createNotificationsApi({ transport });
    const error = await api.inbox.unreadCount().catch(e => e);
    expect(error.kind).toBe('contract');
    expect(isRetryable(error)).toBe(false);
  });

  it('reports a transport failure as a retryable network error', async () => {
    const api = createNotificationsApi({
      transport: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const error = await api.inbox.unreadCount().catch(e => e);
    expect(error.kind).toBe('network');
    expect(isRetryable(error)).toBe(true);
  });

  it('lets an abort through untouched', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const api = createNotificationsApi({
      transport: async () => {
        throw abort;
      },
    });
    await expect(api.inbox.unreadCount()).rejects.toBe(abort);
  });

  it('rejects a request body that breaks the contract before sending it', async () => {
    const { transport, requests } = fakeTransport(() => ({ data: {} }));
    const api = createNotificationsApi({ transport });
    const error = await api.announcements
      .publish({
        audienceType: 'ROLE',
        category: 'x',
        templateKey: 'NOT VALID',
        visibleUntil: '2026-11-10T08:00:00Z',
      })
      .catch(e => e);
    expect(error.kind).toBe('contract');
    expect(requests).toHaveLength(0);
  });

  it('resolves operations without a response body', async () => {
    const { transport, requests } = fakeTransport(() => ({ status: 204 }));
    const api = createNotificationsApi({ transport });
    await expect(
      api.suppressions.release('EMAIL', 'a@example.com')
    ).resolves.toBeUndefined();
    expect(requests[0]?.query).toEqual([
      ['channel', 'EMAIL'],
      ['address', 'a@example.com'],
    ]);
  });

  it('exposes Retry-After of a running operation to the poller', async () => {
    const { transport } = fakeTransport(() => ({
      headers: { 'retry-after': '2' },
      data: { id: 'op', status: 'RUNNING', terminal: false },
    }));
    const api = createNotificationsApi({ transport });
    const poll = await api.announcements.emailRun(ID);
    expect(poll.operation.status).toBe('RUNNING');
    expect(poll.retryAfterMs).toBe(2000);
  });
});

describe('api', () => {
  it('reads mark-all-read as the number of items that moved', async () => {
    const { transport } = fakeTransport(() => ({ data: { unread: 4 } }));
    const api = createNotificationsApi({ transport });
    await expect(api.inbox.markAllRead()).resolves.toBe(4);
  });

  it('fails loudly when a single item comes back without an id', async () => {
    const { transport } = fakeTransport(() => ({ data: { category: 'x' } }));
    const api = createNotificationsApi({ transport });
    const error = await api.inbox.get(ID).catch(e => e);
    expect(error.kind).toBe('contract');
  });
});

describe('model', () => {
  it('derives flags and drops rows without an id', () => {
    const page = toInboxPage(
      {
        content: [
          { id: ID, readAt: '2026-10-09T09:40:11Z' },
          { category: 'orphan' },
        ],
        offset: 0,
        totalElements: 2,
      },
      25
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.read).toBe(true);
    expect(page.items[0]?.seen).toBe(false);
    expect(page.hasMore).toBe(false);
  });

  it('computes hasMore from the total, or from a full page without one', () => {
    const rows = [{ id: ID }];
    expect(
      toInboxPage({ content: rows, offset: 0, totalElements: 3 }, 1).hasMore
    ).toBe(true);
    expect(
      toInboxPage({ content: rows, offset: 2, totalElements: 3 }, 1).hasMore
    ).toBe(false);
    expect(toInboxPage({ content: rows, offset: 0 }, 1).hasMore).toBe(true);
    expect(toInboxPage({ content: rows, offset: 0 }, 25).hasMore).toBe(false);
  });

  it('keeps content when a transition answers without it', () => {
    const full = toInboxEntry({ id: ID, subject: 'Hello', bodyText: 'Body' });
    const afterRead = toInboxEntry({ id: ID, readAt: '2026-10-09T09:40:11Z' });
    const merged = mergeInboxEntry(full ?? undefined, afterRead!);
    expect(merged.subject).toBe('Hello');
    expect(merged.bodyText).toBe('Body');
    expect(merged.read).toBe(true);
  });
});

describe('retry', () => {
  const problem = (status: number, retryAfterMs?: number) =>
    new NotificationsError({
      kind: 'problem',
      operation: 'GET /api/v1/inbox',
      message: 'x',
      status,
      retryAfterMs,
    });

  it.each([408, 429, 502, 503, 504])('retries HTTP %i', status => {
    expect(isRetryable(problem(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 410, 422, 500])(
    'does not retry HTTP %i',
    status => {
      expect(isRetryable(problem(status))).toBe(false);
    }
  );

  it('stops after the configured number of retries', () => {
    expect(shouldRetry(0, problem(503))).toBe(true);
    expect(shouldRetry(1, problem(503))).toBe(true);
    expect(shouldRetry(2, problem(503))).toBe(false);
    expect(shouldRetry(0, new Error('other'))).toBe(false);
  });

  it('honours Retry-After over backoff, within the cap', () => {
    expect(retryDelay(0, problem(429, 5000))).toBe(5000);
    expect(retryDelay(0, problem(429, 600_000))).toBe(30_000);
    expect(retryDelay(0, problem(503))).toBe(1000);
    expect(retryDelay(3, problem(503))).toBe(8000);
  });

  it('parses both forms of Retry-After', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    const now = Date.parse('2026-10-12T10:00:00Z');
    expect(parseRetryAfter('Mon, 12 Oct 2026 10:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });
});

describe('odata', () => {
  it('doubles embedded quotes in string literals', () => {
    expect(odataString("o'brien")).toBe("'o''brien'");
  });

  it('builds the expressions the kit emits', () => {
    expect(odata.isNull('readAt')).toBe('readAt eq null');
    expect(odata.in('category', ['a', 'b'])).toBe("category in ('a', 'b')");
    expect(odata.and(odata.isNull('readAt'), undefined, false)).toBe(
      'readAt eq null'
    );
    expect(
      odata.and(odata.isNull('readAt'), odata.eq('categoryClass', 'PLATFORM'))
    ).toBe("(readAt eq null) and (categoryClass eq 'PLATFORM')");
    expect(odata.and()).toBeUndefined();
  });
});
