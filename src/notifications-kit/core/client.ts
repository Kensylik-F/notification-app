import type { z } from 'zod';

import { OPERATIONS } from './generated/operations';
import type { OperationKey } from './generated/operations';
import { NotificationsError, parseProblem, parseRetryAfter } from './errors';
import type { NotificationsTransport } from './transport';

type Operation<K extends OperationKey> = (typeof OPERATIONS)[K];

type PathParam<K extends OperationKey> = Operation<K>['pathParams'][number];
type QueryParam<K extends OperationKey> = Operation<K>['queryParams'][number];
type RequiredQueryParam<K extends OperationKey> =
  Operation<K>['requiredQueryParams'][number];
type HeaderParam<K extends OperationKey> = Operation<K>['headerParams'][number];

export type QueryValue = string | number | boolean;

type PathInput<K extends OperationKey> = [PathParam<K>] extends [never]
  ? { path?: undefined }
  : { path: Record<PathParam<K>, string> };

type QueryInput<K extends OperationKey> = [RequiredQueryParam<K>] extends [
  never,
]
  ? { query?: Partial<Record<QueryParam<K>, QueryValue | undefined>> }
  : {
      query: Record<RequiredQueryParam<K>, QueryValue> &
        Partial<Record<QueryParam<K>, QueryValue | undefined>>;
    };

type BodyInput<K extends OperationKey> =
  Operation<K>['request'] extends z.ZodType
    ? Operation<K>['requestBodyRequired'] extends true
      ? { body: z.input<Operation<K>['request']> }
      : { body?: z.input<Operation<K>['request']> }
    : { body?: undefined };

export type CallInput<K extends OperationKey> = PathInput<K> &
  QueryInput<K> &
  BodyInput<K> & {
    headers?: Partial<Record<HeaderParam<K>, string>>;
    signal?: AbortSignal;
  };

export type ResponseOf<K extends OperationKey> =
  Operation<K>['response'] extends z.ZodType
    ? z.output<Operation<K>['response']>
    : void;

export interface CallResult<K extends OperationKey> {
  data: ResponseOf<K>;
  status: number;
  /** From `Retry-After`. The service sends it while an operation is still
   *  running, as the interval to wait before polling again. */
  retryAfterMs: number | undefined;
  /** Lower-cased header names. */
  headers: Readonly<Record<string, string>>;
}

export interface NotificationsClientOptions {
  transport: NotificationsTransport;
  /** Sent as `Accept-Language`; the service localises `detail` and renders
   *  announcements from it. */
  acceptLanguage?: () => string | undefined;
}

export interface NotificationsClient {
  call<K extends OperationKey>(
    key: K,
    input: CallInput<K>
  ): Promise<ResponseOf<K>>;
  callWithMeta<K extends OperationKey>(
    key: K,
    input: CallInput<K>
  ): Promise<CallResult<K>>;
}

interface LooseInput {
  path?: Record<string, string>;
  query?: Record<string, QueryValue | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

function normaliseHeaders(
  headers: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) out[name.toLowerCase()] = value;
  }
  return out;
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function hasBody(data: unknown): boolean {
  return data !== undefined && data !== null && data !== '';
}

export function createNotificationsClient(
  options: NotificationsClientOptions
): NotificationsClient {
  const { transport, acceptLanguage } = options;

  async function callWithMeta<K extends OperationKey>(
    key: K,
    input: CallInput<K>
  ): Promise<CallResult<K>> {
    const operation = OPERATIONS[key];
    const loose = input as LooseInput;

    const path = operation.path.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = loose.path?.[name];
      if (value === undefined || value === '') {
        throw new NotificationsError({
          kind: 'contract',
          operation: key,
          message: `${key}: path parameter "${name}" is missing`,
        });
      }
      return encodeURIComponent(value);
    });

    const query: Array<readonly [string, string]> = [];
    for (const name of operation.queryParams as readonly string[]) {
      const value = loose.query?.[name];
      if (value !== undefined) query.push([name, String(value)]);
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    const language = acceptLanguage?.();
    if (language) headers['Accept-Language'] = language;
    for (const name of operation.headerParams as readonly string[]) {
      const value = loose.headers?.[name];
      if (value !== undefined) headers[name] = value;
    }

    let body: unknown;
    if (operation.request !== null && loose.body !== undefined) {
      const parsed = operation.request.safeParse(loose.body);
      if (!parsed.success) {
        throw new NotificationsError({
          kind: 'contract',
          operation: key,
          message: `${key}: request body does not match the contract`,
          cause: parsed.error,
        });
      }
      body = parsed.data;
    }

    let response;
    try {
      response = await transport({
        method: operation.method,
        path,
        query,
        headers,
        body,
        signal: loose.signal,
      });
    } catch (error) {
      // An abort is the caller's own decision, not a failure to report.
      if (isAbort(error)) throw error;
      throw new NotificationsError({
        kind: 'network',
        operation: key,
        message: `${key}: no response received`,
        cause: error,
      });
    }

    const responseHeaders = normaliseHeaders(response.headers);
    const retryAfterMs = parseRetryAfter(responseHeaders['retry-after']);

    if (response.status < 200 || response.status >= 300) {
      const problem = parseProblem(response.data);
      throw new NotificationsError({
        kind: 'problem',
        operation: key,
        status: response.status,
        problem,
        retryAfterMs,
        message:
          problem?.detail ??
          problem?.title ??
          `${key}: HTTP ${response.status}`,
      });
    }

    let data: unknown;
    if (operation.response !== null) {
      const parsed = hasBody(response.data)
        ? operation.response.safeParse(response.data)
        : undefined;
      if (!parsed?.success) {
        throw new NotificationsError({
          kind: 'contract',
          operation: key,
          status: response.status,
          message: `${key}: response does not match the contract`,
          cause: parsed?.error,
        });
      }
      data = parsed.data;
    }

    return {
      data: data as ResponseOf<K>,
      status: response.status,
      retryAfterMs,
      headers: responseHeaders,
    };
  }

  return {
    callWithMeta,
    call: async (key, input) => (await callWithMeta(key, input)).data,
  };
}
