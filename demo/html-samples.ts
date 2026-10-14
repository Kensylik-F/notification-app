// Announcement bodies for checking how HTML travels: what the editor keeps
// (sanitizeHtml) and how the cabinet shows what the service returns. The
// demo serves them instead of its usual announcements with `?samples=html`.

export interface HtmlSample {
  key: string;
  subject: string;
  bodyHtml: string | null;
  bodyText: string | null;
}

export const HTML_SAMPLES: HtmlSample[] = [
  {
    key: 'text-only',
    subject: '1. Только текст',
    bodyHtml: null,
    bodyText:
      'Выгрузки до 100 000 строк теперь формируются за минуту. Ничего делать не нужно.',
  },
  {
    key: 'simple',
    subject: '2. Простой HTML',
    bodyHtml:
      '<p>Выгрузки до <strong>100 000 строк</strong> теперь формируются за минуту.</p>',
    bodyText: null,
  },
  {
    key: 'actions',
    subject: '3. С действиями',
    bodyHtml:
      '<p>Появился предзаказ данных. Выберите атрибуты источника и отправьте заявку на согласование.</p>' +
      '<p><a href="https://onecheck.example.ru/preorders/new">Оформить заявку</a></p>' +
      '<p>Ссылка внутрь кабинета: <a href="/preorders/new?source=4821">оформить по источнику 4821</a></p>' +
      '<p>Вопросы — <a href="mailto:support@example.ru">support@example.ru</a>, инструкция — <a href="https://wiki.example.ru/onecheck/preorder">в вики</a>.</p>',
    bodyText: null,
  },
  {
    key: 'complex',
    subject: '4. Очень сложная структура',
    bodyHtml:
      '<h1>Релиз 2.6</h1>' +
      '<p>Коротко: <em>быстрее</em>, <u>понятнее</u>, <s>без старых отчётов</s>. Код: <code>ARPL-3705</code>.</p>' +
      '<h2>Что нового</h2>' +
      '<ol><li>Предзаказ данных<ul><li>атрибуты источника<ul><li>обязательные</li><li>необязательные — <a href="https://wiki.example.ru/attrs">список</a></li></ul></li><li>согласование в карточке</li></ul></li>' +
      '<li>Фильтр каталога по владельцу</li><li>Выгрузки до 100 000 строк</li></ol>' +
      '<blockquote>Старые отчёты будут удалены 1 ноября. Сохраните нужные.</blockquote>' +
      '<h3>Сроки</h3>' +
      '<table border="1"><thead><tr><th>Этап</th><th>Дата</th></tr></thead><tbody><tr><td>Тестовый стенд</td><td>21.10</td></tr><tr><td>Прод</td><td>28.10</td></tr></tbody></table>' +
      '<pre>GET /v1/announcements?$top=20</pre>' +
      '<hr>' +
      '<p style="color:#c00;font-size:20px">Красный крупный текст из style</p>' +
      '<p><img src="https://picsum.photos/seed/onecheck/480/120" alt="Баннер релиза"></p>' +
      '<p>Очень длинная ссылка: https://onecheck.example.ru/catalog/sources/4821/attributes?filter=owner%20eq%20%27ivanov%27&amp;tab=history&amp;page=12</p>' +
      '<p>Эмодзи и спецсимволы: 🚀 ✅ «кавычки» — тире, &lt;угловые&gt; &amp; амперсанд, 5 &gt; 3.</p>',
    bodyText: null,
  },
  {
    key: 'broken',
    subject: '5. Сломанные теги',
    bodyHtml:
      '<p><strong>Жирный без закрытия<p>Новый абзац внутри незакрытого' +
      '<ul><li>пункт без закрытия<li>второй пункт</ul></div></span>' +
      '<b><i>перепутанная вложенность</b></i>' +
      '<a href="javascript:alert(1)">ссылка javascript:</a> ' +
      '<a href="https://example.ru" onclick="alert(1)">ссылка с onclick</a>' +
      '<script defer src="https://evil.example/x.js"></script><script>alert(1)</script>' +
      '<img src="x" onerror="alert(1)">' +
      '<form action="https://evil.example"><input value="логин"><button>Войти</button></form>' +
      '<iframe src="https://example.ru"></iframe>' +
      '<p>Одиночная < скобка и &nbsp;неразрывный пробел &copy;</p>' +
      '<p>Конец сообщения.</p>',
    bodyText: null,
  },
  {
    key: 'hostile-css',
    subject: '6. Стиль, ломающий вид',
    bodyHtml:
      '<style>body{display:none}</style><p>Этот текст скрыт стилем выше.</p>',
    bodyText: null,
  },
  {
    key: 'comment',
    subject: '7. Незакрытый комментарий',
    bodyHtml:
      '<p>Первая часть видна.</p><!-- забыли закрыть комментарий <p>Вторая часть пропала.</p>',
    bodyText: null,
  },
];
