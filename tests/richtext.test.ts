// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptEvaluation":true}}
// Lives outside the kit folder: it needs a DOM, and the host runs the kit's
// own tests in a node environment.
import { describe, expect, it } from 'vitest';

import {
  htmlToText,
  sanitizeHtml,
} from '../src/notifications-kit/react/admin/richtext';

describe('sanitizeHtml', () => {
  it('keeps document markup and drops everything else', () => {
    const dirty =
      '<h1 style="color:red">Title</h1><div onclick="x()">Hi <b>there</b>' +
      '<script>alert(1)</script><img src=x onerror=alert(1)></div>' +
      '<a href="javascript:alert(1)">bad</a> <a href="https://sber.ru" class="x">ok</a>' +
      '<span style="font-size:40px">loose</span>';
    expect(sanitizeHtml(dirty)).toBe(
      '<h2>Title</h2><p>Hi <strong>there</strong></p>' +
        '<p>bad <a href="https://sber.ru" target="_blank" rel="noopener noreferrer">ok</a>loose</p>'
    );
  });

  it('wraps loose text in a paragraph and removes empty ones', () => {
    expect(sanitizeHtml('plain <em>text</em><p></p>')).toBe(
      '<p>plain <em>text</em></p>'
    );
  });
});

describe('htmlToText', () => {
  it('turns blocks, lists and links into readable text', () => {
    const html =
      '<h2>Работы</h2><p>Сервис будет <strong>недоступен</strong>.</p>' +
      '<ul><li>с 22:00</li><li>до 23:00</li></ul>' +
      '<ol><li>Сохраните</li><li>Выйдите</li></ol>' +
      '<p>Подробнее: <a href="https://sber.ru/x">страница</a></p>';
    expect(htmlToText(html)).toBe(
      'Работы\n\nСервис будет недоступен.\n\n• с 22:00\n• до 23:00\n\n' +
        '1. Сохраните\n2. Выйдите\n\nПодробнее: страница (https://sber.ru/x)'
    );
  });
});
