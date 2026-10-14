// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptEvaluation":true}}
// Lives outside the kit folder: it needs a DOM, and the host runs the kit's
// own tests in a node environment.
import { describe, expect, it } from 'vitest';

import {
  cleanForDisplay,
  htmlToText,
  linkTarget,
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

  it('never puts a block inside a paragraph', () => {
    expect(
      sanitizeHtml(
        'Строка&nbsp;один<div>два<ul><li>пункт</li></ul></div><p>три<blockquote>цитата</blockquote></p>'
      )
    ).toBe(
      '<p>Строка один</p><p>два</p><ul><li>пункт</li></ul><p>три</p><blockquote>цитата</blockquote>'
    );
  });

  it('reads an editor with only empty lines as empty', () => {
    expect(
      sanitizeHtml('<p><br></p><div><br></div><ul><li><br></li></ul>')
    ).toBe('');
    expect(sanitizeHtml('<br><br>')).toBe('');
  });
});

describe('htmlToText', () => {
  it('turns blocks, lists and links into readable text', () => {
    const html =
      '<h2>Работы</h2><p>Сервис будет <strong>недоступен</strong>.</p>' +
      '<ul><li>с 22:00</li><li>до 23:00</li></ul>' +
      '<ol><li>Сохраните</li><li>Выйдите</li></ol>' +
      '<p>Подробнее: <a href="https://sber.ru/x">страница</a></p>' +
      '<p>Пишите на <a href="mailto:help@sber.ru">help@sber.ru</a></p>';
    expect(htmlToText(html)).toBe(
      'Работы\n\nСервис будет недоступен.\n\n• с 22:00\n• до 23:00\n\n' +
        '1. Сохраните\n2. Выйдите\n\nПодробнее: страница (https://sber.ru/x)\n\n' +
        'Пишите на help@sber.ru'
    );
  });
});

describe('edge cases', () => {
  it('keeps tables', () => {
    const table = sanitizeHtml(
      '<table border="1"><tr><th>Этап</th><th>Дата</th></tr><tr><td>Прод</td><td>28.10</td></tr></table>'
    );
    expect(table).toMatch(/^<table>/);
    expect(table).toContain('<th>Этап</th><th>Дата</th>');
    expect(table).toContain('<td>Прод</td><td>28.10</td>');
    expect(
      htmlToText(
        '<p>Сроки</p><table><tr><th>Этап</th><th>Дата</th></tr><tr><td>Прод</td><td>28.10</td></tr></table>'
      )
    ).toBe('Сроки\n\nЭтап | Дата\nПрод | 28.10');
  });

  it('turns a cabinet path into a full address and refuses others', () => {
    expect(linkTarget('/preorders/new?x=1', 'https://onecheck.ru')).toBe(
      'https://onecheck.ru/preorders/new?x=1'
    );
    expect(linkTarget('//evil.example/x', 'https://onecheck.ru')).toBeNull();
    expect(linkTarget('javascript:alert(1)', 'https://onecheck.ru')).toBeNull();
    expect(linkTarget('https://wiki.ru/a')).toBe('https://wiki.ru/a');
  });

  it('never leaves a block inside inline markup', () => {
    const out = sanitizeHtml(
      '<p><strong>Открыт<p>Второй абзац</p><b><i>смесь</b></i>'
    );
    expect(out).not.toMatch(/<(strong|em)>(?:(?!<\/\1>).)*<p>/);
    expect(out).not.toMatch(/<p>(?:(?!<\/p>).)*<p>/);
  });

  it('drops scripts, styles, frames and forms from shown HTML', () => {
    const out = cleanForDisplay(
      '<style>body{display:none}</style><p onclick="x()" style="color:red">Текст</p>' +
        '<script>alert(1)</script>' +
        '<input><button>Войти</button>' +
        '<a href="javascript:alert(1)">a</a><b onmouseover="z()">b</b>'
    );
    expect(out).toBe('<p style="color:red">Текст</p><a>a</a><b>b</b>');
  });
});
