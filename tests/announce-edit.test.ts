// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';

import type { PublishAnnouncementRequest } from '../src/notifications-kit/core';
import {
  endOfYesterday,
  requestToContent,
  textToHtml,
  validateWindow,
} from '../src/notifications-kit/react/admin/AnnouncementEditor';
import {
  readPublished,
  rememberCorrection,
  rememberPublished,
  rememberWindow,
} from '../src/notifications-kit/react/admin/publishedJournal';

const ID = '7c3f1d2e-1111-4a2b-8c3d-000000000001';

const freeform: PublishAnnouncementRequest = {
  category: 'platform-incident',
  audienceType: 'EVERYONE',
  templateKey: 'custom-message',
  variables: { subject: 'Работы', bodyHtml: '<p>Ночью</p>', bodyText: 'Ночью' },
  visibleUntil: '2026-10-30T10:00:00.000Z',
};

const fromTemplate: PublishAnnouncementRequest = {
  category: 'platform-release',
  audienceType: 'ROLE',
  audienceValue: 'MODERATOR',
  templateKey: 'platform-release',
  variables: { productName: 'OneCheck', version: '2.6' },
  visibleUntil: '2026-10-30T10:00:00.000Z',
};

describe('requestToContent', () => {
  it('turns the free-form template back into the editor fields', () => {
    expect(requestToContent(freeform, 'custom-message')).toEqual({
      mode: 'freeform',
      subject: 'Работы',
      bodyHtml: '<p>Ночью</p>',
      bodyText: 'Ночью',
    });
  });

  it('turns any other template into its key and parameters', () => {
    expect(requestToContent(fromTemplate, 'custom-message')).toEqual({
      mode: 'template',
      templateKey: 'platform-release',
      variables: [
        { name: 'productName', value: 'OneCheck' },
        { name: 'version', value: '2.6' },
      ],
    });
  });
});

describe('textToHtml', () => {
  it('makes paragraphs and line breaks, escaping markup', () => {
    expect(textToHtml('Первая строка\nвторая\n\nНовый <абзац> & всё')).toBe(
      '<p>Первая строка<br>вторая</p><p>Новый &lt;абзац&gt; &amp; всё</p>'
    );
    expect(textToHtml('   ')).toBe('');
  });
});

describe('published journal', () => {
  beforeEach(() => window.localStorage.clear());

  it('remembers what was published and keeps the latest correction', () => {
    rememberPublished(
      'u1',
      {
        id: ID,
        category: 'platform-release',
        publishedAt: '2026-10-21T10:00:00Z',
      },
      fromTemplate
    );
    expect(readPublished('u1').map(r => r.id)).toEqual([ID]);
    expect(readPublished('u2')).toEqual([]);

    const corrected = {
      ...fromTemplate,
      variables: { productName: 'OneCheck', version: '2.6.1' },
    };
    rememberCorrection('u1', ID, corrected);
    const [record] = readPublished('u1');
    expect(record?.request.variables).toEqual(corrected.variables);
    expect(record?.correctedAt).toBeTruthy();
  });

  it('ignores a correction of an announcement published elsewhere', () => {
    rememberCorrection('u1', ID, freeform);
    expect(readPublished('u1')).toEqual([]);
  });
});

describe('the display window', () => {
  it('"remove" ends the display with the previous day', () => {
    const end = endOfYesterday(new Date(2026, 9, 27, 14, 30));
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(9);
    expect(end.getDate()).toBe(26);
    expect([end.getHours(), end.getMinutes()]).toEqual([23, 59]);
  });

  it('a past end is allowed; a future one must follow the start', () => {
    const day = 86_400_000;
    const at = (offset: number) => new Date(Date.now() + offset).toISOString();
    expect(validateWindow(at(-5 * day), at(-day), 90)).toEqual({});
    expect(validateWindow(at(2 * day), at(day), 90)).toEqual({
      until: 'beforeStart',
    });
    expect(validateWindow(at(0), at(91 * day), 90)).toEqual({
      until: 'tooLong',
    });
    expect(validateWindow('', '', 90)).toEqual({ until: 'required' });
  });

  it('the journal keeps the new dates', () => {
    rememberPublished(
      'w',
      { id: ID, visibleUntil: '2026-11-01T00:00:00Z' },
      {
        category: 'custom-notice',
        audienceType: 'EVERYONE',
        templateKey: 'custom-message',
        visibleUntil: '2026-11-01T00:00:00Z',
      }
    );
    rememberWindow('w', ID, {
      visibleFrom: null,
      visibleUntil: '2026-10-26T20:59:00.000Z',
    });
    const [record] = readPublished('w');
    expect(record!.announcement.visibleUntil).toBe('2026-10-26T20:59:00.000Z');
    expect(record!.request.visibleUntil).toBe('2026-10-26T20:59:00.000Z');
  });
});
