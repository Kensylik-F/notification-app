/**
 * The small part of OData the kit itself needs to emit.
 *
 * Which properties and operators are allowed is the service's decision,
 * published at `GET /api/v1/filter-metadata/{entity}`. The helpers below only
 * build syntactically valid expressions; they do not know the policy.
 */

/** OData string literal: single quotes, an embedded quote is doubled. */
export function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export type ODataExpression = string;

export const odata = {
  eq: (path: string, value: string): ODataExpression =>
    `${path} eq ${odataString(value)}`,
  ne: (path: string, value: string): ODataExpression =>
    `${path} ne ${odataString(value)}`,
  isNull: (path: string): ODataExpression => `${path} eq null`,
  isNotNull: (path: string): ODataExpression => `${path} ne null`,
  in: (path: string, values: readonly string[]): ODataExpression =>
    `${path} in (${values.map(odataString).join(', ')})`,
  /** Instants are written bare, in ISO-8601 with an offset. */
  ge: (path: string, instant: string): ODataExpression =>
    `${path} ge ${instant}`,
  le: (path: string, instant: string): ODataExpression =>
    `${path} le ${instant}`,
  /** Joins with `and`; empty parts are skipped. `undefined` when none. */
  and: (
    ...parts: ReadonlyArray<ODataExpression | undefined | false | null>
  ): ODataExpression | undefined => {
    const present = parts.filter(
      (part): part is ODataExpression => typeof part === 'string' && part !== ''
    );
    if (present.length === 0) return undefined;
    if (present.length === 1) return present[0];
    return present.map(part => `(${part})`).join(' and ');
  },
};

/** The query options every paged endpoint of the service accepts. */
export interface PageQuery {
  filter?: ODataExpression;
  orderBy?: string;
  /** Page size. Capped by the endpoint's maximum (100 for inbox). */
  top?: number;
  /** Absolute row offset. */
  skip?: number;
  /** `false` skips the count query; the page then carries no total. */
  count?: boolean;
}

export function toODataQuery(query: PageQuery = {}) {
  return {
    $filter: query.filter,
    $orderby: query.orderBy,
    $top: query.top,
    $skip: query.skip,
    $count: query.count,
  };
}

/** Entity names for `GET /api/v1/filter-metadata/{entity}`. */
export const FILTER_ENTITIES = {
  INBOX: 'notification-inbox',
  ANNOUNCEMENT: 'notification-announcement',
} as const;

/** Page limits the service declares for these feeds at the pinned commit.
 *  `GET /api/v1/filter-metadata/{entity}` is the live source. */
export const PAGE_LIMITS = {
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
} as const;
