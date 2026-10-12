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

function dayDiff(time: number, now: number): number {
  const a = new Date(time);
  const b = new Date(now);
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((startB - startA) / DAY);
}

function clock(time: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(time);
}

function shortDate(time: number, now: number, locale: string): string {
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(time);
}

/**
 * The time column of a list: "09:00" today, "вчера", "8 окт." this year,
 * with the year before that. `null` for a missing instant.
 */
export function formatListTime(
  instant: string | null,
  now: number,
  locale: string
): string | null {
  if (!instant) return null;
  const time = Date.parse(instant);
  if (Number.isNaN(time)) return null;
  const days = dayDiff(time, now);
  if (days <= 0) return clock(time, locale);
  if (days === 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      -1,
      'day'
    );
  }
  return shortDate(time, now, locale);
}

/** A card's time: "сегодня, 08:00", "вчера, 17:42", "8 окт., 15:03". */
export function formatCardTime(
  instant: string | null,
  now: number,
  locale: string
): string | null {
  if (!instant) return null;
  const time = Date.parse(instant);
  if (Number.isNaN(time)) return null;
  const days = dayDiff(time, now);
  if (days <= 1 && days >= 0) {
    const word = new Intl.RelativeTimeFormat(locale, {
      numeric: 'auto',
    }).format(-days, 'day');
    return `${word}, ${clock(time, locale)}`;
  }
  return `${shortDate(time, now, locale)}, ${clock(time, locale)}`;
}

/** "19 октября", with the year when it is not this year's and the time
 *  when it is not midnight: "14 октября, 06:00". */
export function formatDay(
  instant: string | null,
  now: number,
  locale: string
): string | null {
  if (!instant) return null;
  const time = Date.parse(instant);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(time);
  return date.getHours() === 0 && date.getMinutes() === 0
    ? day
    : `${day}, ${clock(time, locale)}`;
}
