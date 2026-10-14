import { describe, expect, it } from 'vitest';

import type { AnnouncementEntry, InboxEntry } from '../core';
import {
  asRead,
  asSeen,
  countsAsUnread,
  findEntry,
  flatten,
  patchAll,
  patchEntry,
  removeEntry,
} from './cache';
import type { InboxListData } from './cache';
import { hasMore, plainText } from './content';
import {
  formatCardTime,
  formatDay,
  formatListTime,
  formatRelative,
} from './format';
import {
  createTranslate,
  interpolate,
  MESSAGES_EN,
  MESSAGES_RU,
  plural,
} from './messages';
import {
  byPriority,
  presentationByCategory,
  presentationByClass,
  queueAnnouncements,
} from './presentation';

const entry = (id: string, patch: Partial<InboxEntry> = {}): InboxEntry => ({
  id,
  templateKey: null,
  category: 'account',
  categoryClass: null,
  priority: null,
  locale: null,
  subject: null,
  bodyText: null,
  bodyHtml: null,
  createdAt: '2026-10-12T09:00:00Z',
  seenAt: null,
  readAt: null,
  dismissedAt: null,
  seen: false,
  read: false,
  dismissed: false,
  ...patch,
});

const list = (...pages: InboxEntry[][]): InboxListData => ({
  pageParams: pages.map((_, index) => index * 2),
  pages: pages.map((items, index) => ({
    items,
    offset: index * 2,
    total: 4,
    hasMore: index < pages.length - 1,
  })),
});

describe('cache edits', () => {
  const data = list([entry('a'), entry('b')], [entry('c'), entry('d')]);

  it('patches one row and leaves untouched pages identical', () => {
    const next = patchEntry(data, 'c', e => asRead(e, 'T'));
    expect(findEntry(next, 'c')?.read).toBe(true);
    expect(findEntry(next, 'c')?.seen).toBe(true);
    expect(next?.pages[0]).toBe(data.pages[0]);
  });

  it('returns the same object when the row is not there', () => {
    expect(patchEntry(data, 'zzz', e => asRead(e, 'T'))).toBe(data);
    expect(removeEntry(data, 'zzz')).toBe(data);
  });

  it('removes a row and lowers that page total', () => {
    const next = removeEntry(data, 'b');
    expect(flatten(next).map(e => e.id)).toEqual(['a', 'c', 'd']);
    expect(next?.pages[0]?.total).toBe(3);
  });

  it('marks every row read', () => {
    const next = patchAll(data, e => asRead(e, 'T'));
    expect(flatten(next).every(e => e.read)).toBe(true);
  });

  it('never rewrites an instant that is already set', () => {
    const read = entry('a', {
      read: true,
      readAt: 'FIRST',
      seen: true,
      seenAt: 'S',
    });
    expect(asRead(read, 'SECOND')).toBe(read);
    expect(asSeen(read, 'SECOND')).toBe(read);
    expect(asRead(entry('a', { seen: true, seenAt: 'S' }), 'R').seenAt).toBe(
      'S'
    );
  });

  it('counts an item as unread only while it is neither read nor dismissed', () => {
    expect(countsAsUnread(entry('a'))).toBe(true);
    expect(countsAsUnread(entry('a', { read: true }))).toBe(false);
    expect(countsAsUnread(entry('a', { dismissed: true }))).toBe(false);
    expect(countsAsUnread(undefined)).toBe(false);
  });
});

const announcement = (
  id: string,
  category: string,
  patch: Partial<AnnouncementEntry> = {}
): AnnouncementEntry => ({
  id,
  category,
  categoryClass: 'PLATFORM',
  locale: 'ru',
  subject: id,
  bodyText: null,
  bodyHtml: null,
  publishedAt: null,
  visibleFrom: '2026-10-01T00:00:00Z',
  visibleUntil: '2026-11-01T00:00:00Z',
  dismissed: false,
  ...patch,
});

describe('announcement queue', () => {
  const now = Date.parse('2026-10-12T10:00:00Z');
  const at = (minutes: number) =>
    new Date(now - minutes * 60_000).toISOString();
  const options = {
    resolve: presentationByClass(),
    hidden: new Set<string>(),
    now,
  };

  it('shows each class its own way by default', () => {
    const resolve = presentationByClass();
    expect(
      resolve(announcement('a', 'x', { categoryClass: 'TRANSACTIONAL' }))
    ).toBe('modal');
    expect(resolve(announcement('a', 'x', { categoryClass: 'PLATFORM' }))).toBe(
      'toast'
    );
    expect(
      resolve(announcement('a', 'x', { categoryClass: 'MARKETING' }))
    ).toBe('corner');
    expect(resolve(announcement('a', 'x', { categoryClass: null }))).toBe(
      'corner'
    );
  });

  it('lets a category override the class', () => {
    const resolve = presentationByCategory({ quiet: 'none', loud: 'modal' });
    expect(
      resolve(announcement('a', 'quiet', { categoryClass: 'TRANSACTIONAL' }))
    ).toBe('none');
    expect(
      resolve(announcement('a', 'loud', { categoryClass: 'MARKETING' }))
    ).toBe('modal');
    expect(
      resolve(announcement('a', 'other', { categoryClass: 'PLATFORM' }))
    ).toBe('toast');
  });

  it('queues dialogs and strips oldest first, the deck newest first', () => {
    const queue = queueAnnouncements(
      [
        announcement('m-new', 'x', {
          categoryClass: 'TRANSACTIONAL',
          publishedAt: at(1),
        }),
        announcement('m-old', 'x', {
          categoryClass: 'TRANSACTIONAL',
          publishedAt: at(9),
        }),
        announcement('t-new', 'x', {
          categoryClass: 'PLATFORM',
          publishedAt: at(2),
        }),
        announcement('t-old', 'x', {
          categoryClass: 'PLATFORM',
          publishedAt: at(8),
        }),
        announcement('c-old', 'x', {
          categoryClass: 'MARKETING',
          publishedAt: at(7),
        }),
        announcement('c-new', 'x', {
          categoryClass: 'MARKETING',
          publishedAt: at(3),
        }),
      ],
      options
    );
    expect(queue.modal.map(a => a.id)).toEqual(['m-old', 'm-new']);
    expect(queue.toast.map(a => a.id)).toEqual(['t-old', 't-new']);
    expect(queue.corner.map(a => a.id)).toEqual(['c-new', 'c-old']);
  });

  it('has no limit on the deck', () => {
    const queue = queueAnnouncements(
      ['1', '2', '3', '4', '5', '6', '7'].map(id =>
        announcement(id, 'x', { categoryClass: 'MARKETING' })
      ),
      options
    );
    expect(queue.corner).toHaveLength(7);
  });

  it('skips dismissed, hidden and out-of-window announcements', () => {
    const queue = queueAnnouncements(
      [
        announcement('dismissed', 'x', { dismissed: true }),
        announcement('hidden', 'x'),
        announcement('expired', 'x', { visibleUntil: '2026-10-12T09:59:59Z' }),
        announcement('future', 'x', { visibleFrom: '2026-10-13T00:00:00Z' }),
        announcement('ok', 'x'),
      ],
      { ...options, hidden: new Set(['hidden']) }
    );
    expect(queue.toast.map(a => a.id)).toEqual(['ok']);
  });

  it('sorts lists by importance, then newest first', () => {
    const sorted = byPriority([
      announcement('m-old', 'x', {
        categoryClass: 'MARKETING',
        publishedAt: at(9),
      }),
      announcement('p', 'x', { categoryClass: 'PLATFORM', publishedAt: at(1) }),
      announcement('t', 'x', {
        categoryClass: 'TRANSACTIONAL',
        publishedAt: at(30),
      }),
      announcement('m-new', 'x', {
        categoryClass: 'MARKETING',
        publishedAt: at(2),
      }),
    ]);
    expect(sorted.map(a => a.id)).toEqual(['t', 'p', 'm-new', 'm-old']);
  });
});

describe('formatting and messages', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');

  it('formats recent instants relatively', () => {
    expect(formatRelative('2026-10-12T11:59:30Z', now, 'en')).toBe('now');
    expect(formatRelative('2026-10-12T11:55:00Z', now, 'en')).toBe(
      '5 minutes ago'
    );
    expect(formatRelative('2026-10-12T09:00:00Z', now, 'en')).toBe(
      '3 hours ago'
    );
    expect(formatRelative('2026-10-11T11:00:00Z', now, 'en')).toBe('yesterday');
  });

  it('falls back to a date after a week, and to null for bad input', () => {
    expect(formatRelative('2026-09-01T12:00:00Z', now, 'en')).toBe('Sep 1');
    expect(formatRelative('2025-09-01T12:00:00Z', now, 'en')).toBe(
      'Sep 1, 2025'
    );
    expect(formatRelative(null, now, 'en')).toBeNull();
    expect(formatRelative('not a date', now, 'en')).toBeNull();
  });

  it('keeps both dictionaries on the same set of keys', () => {
    expect(Object.keys(MESSAGES_EN).sort()).toEqual(
      Object.keys(MESSAGES_RU).sort()
    );
  });

  it('interpolates and applies overrides', () => {
    expect(interpolate('{a} of {b}', { a: 1 })).toBe('1 of {b}');
    const t = createTranslate('ru-RU', { 'bell.title': 'Центр уведомлений' });
    expect(t('bell.title')).toBe('Центр уведомлений');
    expect(t('inbox.total', { count: 7 })).toBe('Всего: 7');
    expect(createTranslate('en')('bell.title')).toBe('Notifications');
  });
});

describe('times, plurals and card text (0.4)', () => {
  // Local-time instants, so the day boundaries do not depend on the zone.
  const at = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(y, m - 1, d, h, min).toISOString();
  const now = Date.parse(at(2026, 10, 13, 12, 0));

  it('gives a list the clock today, "yesterday", then a short date', () => {
    expect(formatListTime(at(2026, 10, 13, 9, 5), now, 'en')).toMatch(/09:05/);
    expect(formatListTime(at(2026, 10, 12, 23, 0), now, 'ru')).toBe('вчера');
    expect(formatListTime(at(2026, 10, 8, 10), now, 'en')).toBe('Oct 8');
    expect(formatListTime(at(2025, 10, 8, 10), now, 'en')).toBe('Oct 8, 2025');
    expect(formatListTime(null, now, 'en')).toBeNull();
  });

  it('gives a card the day word with the time', () => {
    expect(formatCardTime(at(2026, 10, 13, 8, 0), now, 'ru')).toMatch(
      /^сегодня, 08:00$/
    );
    expect(formatCardTime(at(2026, 10, 12, 17, 42), now, 'ru')).toMatch(
      /^вчера, 17:42$/
    );
  });

  it('drops the time at midnight and the year in the current one', () => {
    expect(formatDay(at(2026, 10, 19), now, 'ru')).toBe('19 октября');
    expect(formatDay(at(2026, 10, 14, 6, 0), now, 'ru')).toBe(
      '14 октября, 06:00'
    );
  });

  it('picks Russian and English plural forms', () => {
    const forms = 'получатель|получателя|получателей';
    expect(plural(forms, 1, 'ru')).toBe('получатель');
    expect(plural(forms, 3, 'ru')).toBe('получателя');
    expect(plural(forms, 5, 'ru')).toBe('получателей');
    expect(plural(forms, 21, 'ru')).toBe('получатель');
    expect(plural('delivery|deliveries', 1, 'en')).toBe('delivery');
    expect(plural('delivery|deliveries', 0, 'en')).toBe('deliveries');
  });

  it('offers "read more" for formatting or long text only', () => {
    expect(plainText({ bodyText: '  text ', bodyHtml: null })).toBe('text');
    expect(hasMore({ bodyText: 'short', bodyHtml: '<p>short</p>' })).toBe(
      false
    );
    expect(
      hasMore({ bodyText: 'list', bodyHtml: '<ul><li>list</li></ul>' })
    ).toBe(true);
    expect(hasMore({ bodyText: 'x'.repeat(200), bodyHtml: null })).toBe(true);
  });
});
