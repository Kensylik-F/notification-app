import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import {
  FINAL_STATUSES,
  PAGE_LIMITS,
  deliveryFilter,
  isTerminal,
  notificationKeys,
  retryDelay,
  shouldRetry,
} from '../../core';
import type {
  DeliveryFilter,
  DeliveryResponse,
  NotificationRequestResponse,
  OperationPoll,
  PublishAnnouncementRequest,
  RenderPreviewRequest,
  SendNotificationRequest,
} from '../../core';
import { useNotificationsContext } from '../context';

const retryRead = (failureCount: number, error: unknown) =>
  shouldRetry(failureCount, error);

// ----------------------------------------------------------------- preview

/** Renders with the strictness of a live send, so a missing variable shows
 *  up here rather than in a failed delivery. */
export function useTemplatePreview() {
  const { api } = useNotificationsContext();
  return useMutation({
    mutationFn: (body: RenderPreviewRequest) => api.requests.preview(body),
    retry: false,
  });
}

// -------------------------------------------------------------------- send

export interface SendInput {
  request: SendNotificationRequest;
  /** The same key for every attempt of one submission. */
  idempotencyKey: string;
}

/** Never retried automatically: a repeat goes through the person, with the
 *  same idempotency key, so the service can recognise it. */
export function useSendNotification() {
  const { api } = useNotificationsContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ request, idempotencyKey }: SendInput) =>
      api.requests.submit(request, { idempotencyKey }),
    retry: false,
    onSuccess: answer => {
      if (answer.id) {
        client.setQueryData(notificationKeys.request(answer.id), answer);
      }
      void client.invalidateQueries({
        queryKey: notificationKeys.deliveries(),
      });
    },
  });
}

const REQUEST_POLL_MS = 4_000;
const REQUEST_POLL_LIMIT_MS = 5 * 60_000;

/** Whether the request still has deliveries that are about to move. */
export function requestIsSettling(
  request: NotificationRequestResponse | undefined,
  now = Date.now()
): boolean {
  if (!request) return false;
  if (request.operation && !isTerminal(request.operation)) return true;
  const scheduled = request.scheduledAt ? Date.parse(request.scheduledAt) : 0;
  if (scheduled > now) return false;
  return (request.deliveries ?? []).some(
    d => d.status && !FINAL_STATUSES.has(d.status)
  );
}

/** A submitted request, refreshed while its deliveries are on their way. */
export function useNotificationRequest(
  id: string | undefined,
  submittedAt?: number
) {
  const { api, enabled } = useNotificationsContext();
  return useQuery({
    queryKey: notificationKeys.request(id ?? ''),
    queryFn: ({ signal }) => api.requests.get(id as string, { signal }),
    enabled: enabled && Boolean(id),
    refetchInterval: query => {
      const tooLong =
        submittedAt !== undefined &&
        Date.now() - submittedAt > REQUEST_POLL_LIMIT_MS;
      return !tooLong && requestIsSettling(query.state.data)
        ? REQUEST_POLL_MS
        : false;
    },
    refetchIntervalInBackground: false,
    retry: retryRead,
    retryDelay,
  });
}

// -------------------------------------------------------------- deliveries

export interface DeliverySearchOptions {
  filter: DeliveryFilter;
  page: number;
  pageSize?: number;
}

export function useDeliverySearch({
  filter,
  page,
  pageSize = PAGE_LIMITS.DEFAULT_PAGE_SIZE,
}: DeliverySearchOptions) {
  const { api, enabled, admin } = useNotificationsContext();
  const top = Math.min(pageSize, PAGE_LIMITS.MAX_PAGE_SIZE);
  const query = {
    filter: deliveryFilter(filter),
    orderBy: 'createdAt desc',
    top,
    skip: page * top,
  };
  return useQuery({
    queryKey: notificationKeys.deliveryList(query),
    queryFn: ({ signal }) => api.deliveries.search(query, { signal }),
    enabled: enabled && admin.permissions.deliveries,
    placeholderData: keepPreviousData,
    retry: retryRead,
    retryDelay,
  });
}

export function useDeliveryHistory(id: string, enabled = true) {
  const { api, enabled: on } = useNotificationsContext();
  return useQuery({
    queryKey: notificationKeys.deliveryHistory(id),
    queryFn: ({ signal }) => api.deliveries.history(id, { signal }),
    enabled: on && enabled,
    retry: retryRead,
    retryDelay,
  });
}

/** Reading content is audited by the service, so it is fetched only when
 *  the person asks for it, and never again behind their back. */
export function useDeliveryContent(id: string, requested: boolean) {
  const { api, enabled } = useNotificationsContext();
  return useQuery({
    queryKey: notificationKeys.deliveryContent(id),
    queryFn: ({ signal }) => api.deliveries.content(id, { signal }),
    enabled: enabled && requested,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: retryRead,
    retryDelay,
  });
}

function acceptDelivery(client: QueryClient, answer: DeliveryResponse) {
  if (answer.id) {
    client.setQueryData(notificationKeys.delivery(answer.id), answer);
    void client.invalidateQueries({
      queryKey: notificationKeys.deliveryHistory(answer.id),
    });
  }
  void client.invalidateQueries({
    queryKey: [...notificationKeys.deliveries(), 'list'],
  });
  if (answer.requestId) {
    void client.invalidateQueries({
      queryKey: notificationKeys.request(answer.requestId),
    });
  }
}

/** Retry (DEAD only) and cancel (not yet sent). Not repeated automatically. */
export function useDeliveryCommands() {
  const { api } = useNotificationsContext();
  const client = useQueryClient();
  const retry = useMutation({
    mutationFn: (id: string) => api.deliveries.retry(id),
    retry: false,
    onSuccess: answer => acceptDelivery(client, answer),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.deliveries.cancel(id),
    retry: false,
    onSuccess: answer => acceptDelivery(client, answer),
  });
  return { retry, cancel };
}

// ----------------------------------------------------------- announcements

/** Not idempotent and never retried: a repeat would publish twice. */
export function usePublishAnnouncement() {
  const { api } = useNotificationsContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: PublishAnnouncementRequest) =>
      api.announcements.publish(request),
    retry: false,
    // The publisher may be in the audience too.
    onSuccess: () =>
      void client.invalidateQueries({
        queryKey: notificationKeys.announcements(),
      }),
  });
}

/** Content only: the audience and the window go back unchanged. */
export function useCorrectAnnouncement() {
  const { api } = useNotificationsContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      request,
    }: {
      id: string;
      request: PublishAnnouncementRequest;
    }) => api.announcements.correct(id, request),
    retry: false,
    onSuccess: (_, { id }) => {
      void client.invalidateQueries({
        queryKey: notificationKeys.announcements(),
      });
      void client.invalidateQueries({
        queryKey: notificationKeys.announcement(id),
      });
    },
  });
}

const MIN_POLL_MS = 1_000;
const DEFAULT_POLL_MS = 2_000;
const MAX_POLL_MS = 30_000;

/** The pause the service asks for (Retry-After), within sane bounds. */
export function emailRunPollDelay(
  poll: OperationPoll | undefined
): number | false {
  if (!poll || isTerminal(poll.operation)) return false;
  const asked = poll.retryAfterMs ?? DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, asked));
}

/** Progress of an announcement's email fan-out, polled until terminal. */
export function useEmailRun(announcementId: string, enabled = true) {
  const { api, enabled: on } = useNotificationsContext();
  return useQuery({
    queryKey: notificationKeys.emailRun(announcementId),
    queryFn: ({ signal }) =>
      api.announcements.emailRun(announcementId, { signal }),
    enabled: on && enabled,
    refetchInterval: query => emailRunPollDelay(query.state.data),
    refetchIntervalInBackground: false,
    retry: retryRead,
    retryDelay,
  });
}

/** The stop is requested, not performed; the poll shows when it lands. */
export function useCancelEmailRun() {
  const { api } = useNotificationsContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (announcementId: string) =>
      api.announcements.cancelEmailRun(announcementId),
    retry: false,
    onSuccess: (operation, announcementId) => {
      client.setQueryData<OperationPoll>(
        notificationKeys.emailRun(announcementId),
        previous => ({
          operation,
          retryAfterMs: previous?.retryAfterMs,
        })
      );
      void client.invalidateQueries({
        queryKey: notificationKeys.emailRun(announcementId),
      });
    },
  });
}
