/**
 * notifications-kit core: the contract, the client and the plain logic.
 * No React, no HTTP library, nothing from a host application.
 */
export * from './generated/schemas';
export { OPERATIONS, CONTRACT_INFO } from './generated/operations';
export type { OperationKey } from './generated/operations';
export {
  createFetchTransport,
  toQueryString,
  type FetchTransportOptions,
  type HttpMethod,
  type NotificationsTransport,
  type TransportRequest,
  type TransportResponse,
} from './transport';
export {
  CONTRACT_PREFIX,
  createNotificationsClient,
  requestPath,
  type CallInput,
  type CallResult,
  type NotificationsClient,
  type NotificationsClientOptions,
  type QueryValue,
  type ResponseOf,
} from './client';
export {
  createNotificationsApi,
  type Channel,
  type NotificationsApi,
  type OperationPoll,
} from './api';
export {
  NotificationsError,
  PROBLEM_CODES,
  isNotificationsError,
  parseProblem,
  parseRetryAfter,
  type NotificationsErrorKind,
} from './errors';
export {
  IDEMPOTENT_COMMANDS,
  isRetryable,
  retryDelay,
  shouldRetry,
  type RetryOptions,
} from './retry';
export {
  FILTER_ENTITIES,
  PAGE_LIMITS,
  odata,
  odataString,
  toODataQuery,
  type ODataExpression,
  type PageQuery,
} from './odata';
export {
  mergeInboxEntry,
  toAnnouncementEntry,
  toAnnouncementPage,
  toInboxEntry,
  toInboxPage,
  type AnnouncementEntry,
  type CategoryClass,
  type InboxEntry,
  type Page,
  type Priority,
} from './model';
export { notificationKeys } from './keys';
export * from './admin';
