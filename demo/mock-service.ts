// An in-memory stand-in for the notification service, behind the kit's own
// transport seam. It follows the published contract closely enough to
// exercise the kit: list rows carry no subject or body, transitions are
// idempotent and answer without content, a foreign or missing id is a 404
// problem document.
import type {
  NotificationsTransport,
  TransportResponse,
} from '../src/notifications-kit';
import {
  htmlToText,
  sanitizeHtml,
} from '../src/notifications-kit/react/admin/richtext';
import { HTML_SAMPLES } from './html-samples';
import { ANNOUNCEMENT_CLASS, createAdminMock } from './mock-admin';

interface StoredItem {
  id: string;
  templateKey: string;
  category: string;
  categoryClass: 'TRANSACTIONAL' | 'PLATFORM' | 'MARKETING';
  priority: 'HIGH' | 'NORMAL' | 'BULK';
  locale: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  createdAt: string;
  seenAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
}

type CategoryClass = 'TRANSACTIONAL' | 'PLATFORM' | 'MARKETING';

interface StoredAnnouncement {
  id: string;
  category: string;
  categoryClass: CategoryClass;
  locale: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  publishedAt: string;
  visibleFrom: string;
  visibleUntil: string;
  dismissed: boolean;
}

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const ahead = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

const ITEM_SEED: Array<
  [
    subject: string,
    body: string,
    category: string,
    priority: StoredItem['priority'],
    minutes: number,
    read: boolean,
  ]
> = [
  [
    'Нужна информация по предзаказу',
    'Согласующий запросил уточнить обоснование. Откройте предзаказ и дополните поле «Обоснование».',
    'preorder',
    'HIGH',
    3,
    false,
  ],
  [
    'Предзаказ согласован',
    'Предзаказ согласован и ожидает работ на стороне источника.',
    'preorder',
    'NORMAL',
    48,
    false,
  ],
  [
    'Выгрузка готова',
    'Отчёт сформирован и доступен для скачивания в разделе «Выгрузки».',
    'export',
    'NORMAL',
    190,
    false,
  ],
  [
    'Предзаказ отправлен на согласование',
    'Заявка передана согласующему.',
    'preorder',
    'NORMAL',
    60 * 26,
    true,
  ],
  [
    'Плановые работы завершены',
    'Сервис работает в штатном режиме.',
    'platform',
    'BULK',
    60 * 24 * 3,
    true,
  ],
  [
    'Предзаказ включён в заказ',
    'Ваш предзаказ вошёл в состав заказа.',
    'order',
    'NORMAL',
    60 * 24 * 9,
    true,
  ],
];

export function createMockService(options: { latencyMs?: number } = {}) {
  const latencyMs = options.latencyMs ?? 120;
  let counter = 100;

  const items: StoredItem[] = [];
  for (let i = 0; i < 32; i += 1) {
    const seed = ITEM_SEED[i % ITEM_SEED.length]!;
    const extra = Math.floor(i / ITEM_SEED.length) * 60 * 24 * 11;
    const read = seed[5] || i >= ITEM_SEED.length;
    items.push({
      id: uuid(i + 1),
      templateKey: `${seed[2]}.update`,
      category: seed[2],
      categoryClass: 'TRANSACTIONAL',
      priority: seed[3],
      locale: 'ru',
      subject: seed[0],
      bodyText: seed[1],
      createdAt: ago(seed[4] + extra),
      seenAt: read ? ago(seed[4] + extra - 1) : null,
      readAt: read ? ago(seed[4] + extra - 1) : null,
      dismissedAt: null,
    });
  }

  // One item rendered from an HTML template, as the service would send it.
  items[0]!.bodyHtml =
    '<p>Согласующий запросил уточнить <strong>обоснование</strong> по предзаказу № 4821.</p>' +
    '<ul><li>Откройте карточку предзаказа</li><li>Дополните поле «Обоснование»</li>' +
    '<li>Отправьте повторно</li></ul>' +
    '<p>Подробнее — в <a href="https://example.org/help">справке</a>.</p>';

  const announcements: StoredAnnouncement[] = [
    {
      id: uuid(901),
      category: 'custom-transitions',
      categoryClass: 'TRANSACTIONAL',
      locale: 'ru',
      subject: 'Плановые работы сегодня с 22:00 до 23:00',
      bodyText:
        'В это время сервис будет недоступен. Сохраните черновики заранее: несохранённые изменения будут потеряны.',
      publishedAt: ago(30),
      visibleFrom: ago(30),
      visibleUntil: ahead(1),
      dismissed: false,
    },
    {
      id: uuid(902),
      category: 'custom-marketing',
      categoryClass: 'MARKETING',
      locale: 'ru',
      subject: 'Появился предзаказ данных',
      bodyText:
        'Выберите атрибуты источника и отправьте заявку на согласование прямо из карточки источника.',
      publishedAt: ago(120),
      visibleFrom: ago(120),
      visibleUntil: ahead(20),
      dismissed: false,
    },
    {
      id: uuid(904),
      category: 'custom-marketing',
      categoryClass: 'MARKETING',
      locale: 'ru',
      subject: 'Выгрузки стали быстрее',
      bodyText: 'Отчёты до 100 000 строк формируются за минуту.',
      bodyHtml:
        '<p>Отчёты до <strong>100 000 строк</strong> формируются за минуту.</p>',
      publishedAt: ago(90),
      visibleFrom: ago(90),
      visibleUntil: ahead(10),
      dismissed: false,
    },
    {
      id: uuid(905),
      category: 'custom-marketing',
      categoryClass: 'MARKETING',
      locale: 'ru',
      subject: 'Новый фильтр в каталоге',
      bodyText: 'Фильтруйте источники по владельцу и статусу согласования.',
      publishedAt: ago(60),
      visibleFrom: ago(60),
      visibleUntil: ahead(10),
      dismissed: false,
    },
    {
      id: uuid(906),
      category: 'custom-transitions',
      categoryClass: 'TRANSACTIONAL',
      locale: 'ru',
      subject: 'Согласование предзаказов временно через почту',
      bodyText:
        'Пока идут работы, согласующие получают заявки письмом. Решения из письма учитываются автоматически.',
      bodyHtml:
        '<p>Пока идут работы, согласующие получают заявки <strong>письмом</strong>.</p>' +
        '<ul><li>Решения из письма учитываются автоматически</li>' +
        '<li>Статус в кабинете обновится после окончания работ</li></ul>',
      publishedAt: ago(20),
      visibleFrom: ago(20),
      visibleUntil: ahead(1),
      dismissed: false,
    },
    {
      id: uuid(907),
      category: 'custom-notice',
      categoryClass: 'PLATFORM',
      locale: 'ru',
      subject: 'Обновлён регламент описания источников',
      bodyText:
        'С 1 ноября поле «Назначение» обязательно для всех новых источников.',
      publishedAt: ago(150),
      visibleFrom: ago(150),
      visibleUntil: ahead(14),
      dismissed: false,
    },
    {
      id: uuid(903),
      category: 'custom-notice',
      categoryClass: 'PLATFORM',
      locale: 'ru',
      subject: 'Фильтр источников стал быстрее',
      bodyText:
        'Поиск по названию и КЭ теперь работает без перезагрузки списка.',
      publishedAt: ago(200),
      visibleFrom: ago(200),
      visibleUntil: ahead(5),
      dismissed: false,
    },
  ];

  // `?samples=html`: the HTML checks instead of the usual announcements.
  const sampleParams =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search);
  // `&clean=1`: as if written in the editor - cleaned, with the text twin.
  const asEdited = sampleParams?.get('clean') === '1';
  if (sampleParams?.get('samples') === 'html') {
    announcements.splice(
      0,
      announcements.length,
      ...HTML_SAMPLES.map((sample, index) => ({
        id: uuid(950 + index),
        category: 'custom-marketing',
        categoryClass: 'MARKETING' as const,
        locale: 'ru',
        subject: sample.subject,
        bodyText: asEdited
          ? sample.bodyHtml
            ? htmlToText(sanitizeHtml(sample.bodyHtml))
            : (sample.bodyText ?? '')
          : (sample.bodyText ?? ''),
        bodyHtml:
          asEdited && sample.bodyHtml
            ? sanitizeHtml(sample.bodyHtml)
            : sample.bodyHtml,
        publishedAt: ago(10 + index),
        visibleFrom: ago(10 + index),
        visibleUntil: ahead(5),
        dismissed: false,
      }))
    );
  }

  const admin = createAdminMock({
    publish: a =>
      announcements.push({
        ...a,
        categoryClass: ANNOUNCEMENT_CLASS[a.category] ?? 'MARKETING',
        locale: 'ru',
        dismissed: false,
      }),
    correct: (id, subject, bodyText, bodyHtml) => {
      const found = announcements.find(a => a.id === id);
      if (found) Object.assign(found, { subject, bodyText, bodyHtml });
    },
    window: (id, visibleFrom, visibleUntil) => {
      const found = announcements.find(a => a.id === id);
      if (found) Object.assign(found, { visibleFrom, visibleUntil });
    },
    // Gone from the list, the count and the read by id for everyone.
    withdraw: id => {
      const index = announcements.findIndex(a => a.id === id);
      if (index >= 0) announcements.splice(index, 1);
    },
    lookup: id => {
      const found = announcements.find(a => a.id === id);
      return found
        ? {
            category: String(found.category),
            visibleFrom: found.visibleFrom,
            visibleUntil: found.visibleUntil,
            publishedAt: String(found.publishedAt),
          }
        : undefined;
    },
  });

  const visible = (a: StoredAnnouncement) => {
    const now = Date.now();
    return Date.parse(a.visibleFrom) <= now && now < Date.parse(a.visibleUntil);
  };

  const listView = (item: StoredItem) => ({
    id: item.id,
    templateKey: item.templateKey,
    category: item.category,
    categoryClass: item.categoryClass,
    priority: item.priority,
    locale: item.locale,
    subject: null,
    bodyHtml: null,
    bodyText: null,
    createdAt: item.createdAt,
    seenAt: item.seenAt,
    readAt: item.readAt,
    dismissedAt: item.dismissedAt,
    read: item.readAt !== null,
    dismissed: item.dismissedAt !== null,
  });
  const fullView = (item: StoredItem) => ({
    ...listView(item),
    subject: item.subject,
    bodyText: item.bodyText,
    bodyHtml: item.bodyHtml ?? null,
  });
  const announcementView = (a: StoredAnnouncement) => ({
    ...a,
    bodyHtml: a.bodyHtml ?? null,
  });

  const ok = (data: unknown): TransportResponse => ({
    status: 200,
    headers: { 'content-type': 'application/json' },
    data,
  });
  const notFound = (code: string, path: string): TransportResponse => ({
    status: 404,
    headers: { 'content-type': 'application/problem+json' },
    data: {
      type: 'about:blank',
      title: 'Не найдено',
      status: 404,
      code,
      detail: 'Объект не найден.',
      instance: path,
      traceId: 'demo-trace-0001',
    },
  });

  const page = <T>(rows: T[], query: Map<string, string>) => {
    const top = Math.min(Number(query.get('$top') ?? 25), 100);
    const skip = Number(query.get('$skip') ?? 0);
    const content = rows.slice(skip, skip + top);
    return {
      content,
      offset: skip,
      size: content.length,
      ...(query.get('$count') === 'false'
        ? {}
        : { totalElements: rows.length }),
    };
  };

  const transport: NotificationsTransport = async request => {
    await new Promise(resolve => setTimeout(resolve, latencyMs));
    if (request.signal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    // A record of what the kit sent, for checks in the browser console.
    (window as unknown as { __nkRequests?: unknown[] }).__nkRequests?.push({
      method: request.method,
      path: request.path,
      query: request.query,
      body: request.body,
    });
    const query = new Map(request.query);
    const route = `${request.method} ${request.path}`;
    const now = new Date().toISOString();
    let match: RegExpMatchArray | null;

    if (route === 'GET /inbox/unread-count') {
      return ok({
        unread: items.filter(i => !i.readAt && !i.dismissedAt).length,
      });
    }
    if (route === 'GET /inbox') {
      let rows = items
        .filter(i => !i.dismissedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (query.get('$filter') === 'readAt eq null') {
        rows = rows.filter(i => !i.readAt);
      }
      return ok(page(rows.map(listView), query));
    }
    if (route === 'POST /inbox/read') {
      const unread = items.filter(i => !i.readAt && !i.dismissedAt);
      unread.forEach(i => {
        i.readAt = now;
        i.seenAt ??= now;
      });
      return ok({ unread: unread.length });
    }
    if (
      (match = route.match(
        /^(GET|POST) \/inbox\/([^/]+)(?:\/(seen|read|dismiss))?$/
      ))
    ) {
      const [, method, id, action] = match;
      const item = items.find(i => i.id === id);
      if (!item)
        return notFound('error.notification.inbox.not-found', request.path);
      if (method === 'GET' && !action) return ok(fullView(item));
      if (action === 'seen') item.seenAt ??= now;
      if (action === 'read') {
        item.readAt ??= now;
        item.seenAt ??= now;
      }
      if (action === 'dismiss') item.dismissedAt ??= now;
      return ok(listView(item));
    }

    if (route === 'GET /announcements/outstanding-count') {
      return ok({
        outstanding: announcements.filter(a => !a.dismissed && visible(a))
          .length,
      });
    }
    if (route === 'GET /announcements') {
      const rows = announcements
        .filter(a => !a.dismissed && visible(a))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      return ok(page(rows.map(announcementView), query));
    }
    if (
      (match = route.match(/^(GET|POST) \/announcements\/([^/]+)(\/dismiss)?$/))
    ) {
      const [, , id, action] = match;
      const found = announcements.find(a => a.id === id);
      if (!found) {
        return notFound(
          'error.notification.announcement.not-found',
          request.path
        );
      }
      if (action) found.dismissed = true;
      return ok(announcementView(found));
    }

    const handled = admin.handle(request);
    if (handled) return handled;

    return {
      status: 501,
      headers: {},
      data: { status: 501, code: 'demo.not-implemented', title: route },
    };
  };

  return {
    transport,
    /** Simulates a new notification arriving. */
    push(subject: string, priority: StoredItem['priority'] = 'NORMAL') {
      counter += 1;
      items.push({
        id: uuid(counter),
        templateKey: 'demo.push',
        category: 'demo',
        categoryClass: 'TRANSACTIONAL',
        priority,
        locale: 'ru',
        subject,
        bodyText: 'Это уведомление добавлено кнопкой в демо.',
        createdAt: new Date().toISOString(),
        seenAt: null,
        readAt: null,
        dismissedAt: null,
      });
    },
  };
}
