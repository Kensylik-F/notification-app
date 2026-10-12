/**
 * The one seam between the kit and the host application's HTTP stack.
 *
 * The kit never imports an HTTP client. The host hands it a function that
 * performs one request and reports what came back - including error statuses.
 * Problem documents carry the stable `code` the kit branches on, so a
 * transport that swallows the body of a 4xx/5xx would blind it.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface TransportRequest {
  method: HttpMethod;
  /** Contract path with parameters already substituted, e.g.
   *  `/api/v1/inbox/7c3f.../read`. The host prepends its own prefix. */
  path: string;
  /** Query parameters in order. Names are literal (`$filter`, `$top`). */
  query: ReadonlyArray<readonly [name: string, value: string]>;
  headers: Readonly<Record<string, string>>;
  /** JSON-serialisable body, or `undefined` when the operation has none. */
  body?: unknown;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Header names in any case; the kit normalises them. */
  headers: Readonly<Record<string, string | undefined>>;
  /** Parsed JSON body, or `undefined`/`null`/`''` when there was none. */
  data: unknown;
}

/**
 * Resolves for EVERY HTTP status. Rejects only when no response was received
 * (network failure, timeout, abort).
 */
export type NotificationsTransport = (
  request: TransportRequest
) => Promise<TransportResponse>;

/** `name=value&...` with values percent-encoded and `$` kept literal. */
export function toQueryString(
  query: ReadonlyArray<readonly [string, string]>
): string {
  return query
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('&');
}

export interface FetchTransportOptions {
  /** Prefix in front of the contract path, without a trailing slash. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Extra headers for every request (auth, tracing). */
  headers?: () => Record<string, string>;
  credentials?: RequestCredentials;
}

/** A transport over `fetch`. Useful for demos, tests and hosts without a
 *  preconfigured HTTP client. */
export function createFetchTransport(
  options: FetchTransportOptions = {}
): NotificationsTransport {
  const { baseUrl = '', headers, credentials } = options;

  return async request => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const queryString = toQueryString(request.query);
    const url = `${baseUrl}${request.path}${queryString ? `?${queryString}` : ''}`;
    const hasBody = request.body !== undefined;

    const response = await doFetch(url, {
      method: request.method,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...headers?.(),
        ...request.headers,
      },
      body: hasBody ? JSON.stringify(request.body) : undefined,
      signal: request.signal,
      credentials,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });

    const text = await response.text();
    let data: unknown;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    return { status: response.status, headers: responseHeaders, data };
  };
}
