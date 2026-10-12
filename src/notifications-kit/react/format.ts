const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "5 minutes ago" for the last week, a short date after that. Returns `null`
 * for a missing or unparseable instant, and `'now'` under a minute - the
 * caller owns that word.
 */
export function formatRelative(
  instant: string | null,
  now: number,
  locale: string
): string | 'now' | null {
  if (!instant) return null;
  const time = Date.parse(instant);
  if (Number.isNaN(time)) return null;
  const diff = now - time;
  if (diff < MINUTE) return 'now';

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < HOUR) return relative.format(-Math.floor(diff / MINUTE), 'minute');
  if (diff < DAY) return relative.format(-Math.floor(diff / HOUR), 'hour');
  if (diff < 7 * DAY) return relative.format(-Math.floor(diff / DAY), 'day');

  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(time);
}

export function formatDateTime(
  instant: string | null,
  locale: string
): string | null {
  if (!instant) return null;
  const time = Date.parse(instant);
  if (Number.isNaN(time)) return null;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(time);
}
