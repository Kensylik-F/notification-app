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
import { formatRelative } from './format';
import {
  createTranslate,
  interpolate,
  MESSAGES_EN,
  MESSAGES_RU,
} from './messages';
import { planAnnouncements, presentationByCategory } from './presentation';

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

describe('announcement planning', () => {
  const resolve = presentationByCategory(
    { incident: 'modal', release: 'corner', tip: 'toast', quiet: 'none' },
    'corner'
  );
  const now = Date.parse('2026-10-12T10:00:00Z');
  const options = {
    resolve,
    hidden: new Set<string>(),
    maxCorner: 2,
    maxToasts: 1,
    now,
  };

  it('routes each announcement by its category, with a fallback', () => {
    const plan = planAnnouncements(
      [
        announcement('m', 'incident'),
        announcement('c', 'release'),
        announcement('t', 'tip'),
        announcement('n', 'quiet'),
        announcement('u', 'unmapped'),
      ],
      options
    );
    expect(plan.modal?.id).toBe('m');
    expect(plan.corner.map(a => a.id)).toEqual(['c', 'u']);
    expect(plan.toasts.map(a => a.id)).toEqual(['t']);
  });

  it('shows queued dialogs oldest first, one at a time', () => {
    // The feed is newest first.
    const plan = planAnnouncements(
      [announcement('newer', 'incident'), announcement('older', 'incident')],
      options
    );
    expect(plan.modal?.id).toBe('older');
  });

  it('respects the on-screen limits', () => {
    const plan = planAnnouncements(
      ['1', '2', '3'].map(id => announcement(id, 'release')),
      options
    );
    expect(plan.corner).toHaveLength(2);
  });

  it('skips dismissed, session-hidden and out-of-window announcements', () => {
    const plan = planAnnouncements(
      [
        announcement('dismissed', 'release', { dismissed: true }),
        announcement('hidden', 'tip'),
        announcement('expired', 'release', {
          visibleUntil: '2026-10-12T09:59:59Z',
        }),
        announcement('future', 'release', {
          visibleFrom: '2026-10-13T00:00:00Z',
        }),
        announcement('ok', 'release'),
      ],
      { ...options, hidden: new Set(['hidden']) }
    );
    expect(plan.corner.map(a => a.id)).toEqual(['ok']);
    expect(plan.toasts).toHaveLength(0);
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
