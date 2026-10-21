// The administration half of the demo service: preview, send, delivery
// history, publishing and the email run. Templates are the service's own
// files from contract/templates, rendered by a deliberately small
// FreeMarker subset that is strict like the real renderer: a required
// variable that is missing fails the render.
import type {
  TransportRequest,
  TransportResponse,
} from '../src/notifications-kit';

type Channel = 'EMAIL' | 'CHAT' | 'WEBHOOK' | 'IN_APP';
type Status =
  | 'ACCEPTED'
  | 'PENDING'
  | 'CLAIMED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'DEAD'
  | 'SUPPRESSED'
  | 'CANCELLED';

// The service's example templates plus our free-form one, keyed the same way.
const FILES = Object.fromEntries(
  Object.entries(
    import.meta.glob(
      ['./templates/**/*.ftl', '../service-templates/**/*.ftl'],
      { query: '?raw', import: 'default', eager: true }
    ) as Record<string, string>
  ).map(([path, text]) => [
    path.replace('../service-templates/', './templates/'),
    text,
  ])
);

const CHANNEL_DIR: Record<Channel, string> = {
  EMAIL: 'email',
  CHAT: 'chat',
  WEBHOOK: 'webhook',
  IN_APP: 'in_app',
};

class RenderError extends Error {}

function file(key: string, channel: Channel, locale: string, name: string) {
  return FILES[`./templates/${key}/${CHANNEL_DIR[channel]}/${locale}/${name}`];
}

function localesFor(key: string, channel: Channel): string[] {
  const prefix = `./templates/${key}/${CHANNEL_DIR[channel]}/`;
  return [
    ...new Set(
      Object.keys(FILES)
        .filter(path => path.startsWith(prefix))
        .map(path => path.slice(prefix.length).split('/')[0]!)
    ),
  ];
}

function lookup(vars: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[part]
          : undefined,
      vars
    );
}

// As in FreeMarker: only a missing or null value is missing; "" is a value.
const present = (value: unknown) => value !== undefined && value !== null;

function renderFtl(source: string, vars: Record<string, unknown>): string {
  let text = source.replace(/<#--[\s\S]*?-->/g, '');
  // <#if x??> … </#if>, innermost first.
  const ifBlock = /<#if\s+([\w.]+)\?\?\s*>((?:(?!<#if)[\s\S])*?)<\/#if>/;
  let match: RegExpMatchArray | null;
  while ((match = text.match(ifBlock))) {
    const [whole, name, body] = match;
    text = text.replace(whole, present(lookup(vars, name!)) ? body! : '');
  }
  text = text.replace(/<#list[\s\S]*?<\/#list>/g, '');
  return text
    .replace(
      /\$\{\s*([\w.]+)\s*(!([^}]*))?\}/g,
      (_, name: string, bang, fallback) => {
        const value = lookup(vars, name);
        if (present(value)) return String(value);
        if (bang) return String(fallback ?? '').replace(/^"|"$/g, '');
        throw new RenderError(name);
      }
    )
    .trim();
}

function render(
  key: string,
  channel: Channel,
  requested: string | undefined,
  variables: Record<string, unknown>
) {
  const locales = localesFor(key, channel);
  if (locales.length === 0) return null;
  const locale =
    requested && locales.includes(requested)
      ? requested
      : locales.includes('ru')
        ? 'ru'
        : locales[0]!;
  const vars = { ...variables, locale };
  const part = (name: string) => {
    const source = file(key, channel, locale, name);
    return source === undefined ? null : renderFtl(source, vars);
  };
  return {
    channel,
    templateKey: key,
    templateVersion: '1',
    resolvedLocale: locale,
    subject: part('subject.ftl'),
    textBody: part('body.txt.ftl'),
    htmlBody: part('body.html.ftl'),
  };
}

// ------------------------------------------------------------------ helpers

const json = (
  status: number,
  data: unknown,
  headers: Record<string, string> = {}
) =>
  ({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    data,
  }) as TransportResponse;

const problem = (status: number, code: string, title: string, detail: string) =>
  json(status, {
    type: 'about:blank',
    status,
    code,
    title,
    detail,
    traceId: 'demo-trace-0002',
  });

let sequence = 5000;
const uuid = () =>
  `00000000-0000-4000-9000-${String((sequence += 1)).padStart(12, '0')}`;
const iso = (time: number) => new Date(time).toISOString();

interface Transition {
  from: Status | null;
  to: Status;
  occurredAt: string;
  attemptNumber: number | null;
  detail: string | null;
}

interface Delivery {
  id: string;
  requestId: string;
  templateKey: string;
  category: string;
  categoryClass: string;
  priority: string;
  channel: Channel;
  recipientReference: string;
  status: Status;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  /** When the simulated pipeline starts moving it. */
  startAt: number;
  sentAt: number | null;
  deliveredAt: number | null;
  scheduledAt: number | null;
  lastError: string | null;
  lastFailureClass: 'RETRYABLE' | 'TERMINAL' | null;
  /** The simulated fate. */
  fails: boolean;
  history: Transition[];
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  /** Content past the retention window answers 410. */
  expired: boolean;
}

interface RequestRecord {
  id: string;
  idempotencyKey: string | null;
  templateKey: string;
  category: string;
  categoryClass: string;
  priority: string;
  createdAt: number;
  scheduledAt: number | null;
  deliveryIds: string[];
}

interface EmailRun {
  id: string;
  startedAt: number;
  total: number;
  cancelledAt: number | null;
}

const PER_SECOND = 140;

function move(
  d: Delivery,
  to: Status,
  at: number,
  detail: string | null = null
) {
  d.history.push({
    from: d.status,
    to,
    occurredAt: iso(at),
    attemptNumber:
      to === 'CLAIMED' || to === 'FAILED' || to === 'DEAD' ? d.attempts : null,
    detail,
  });
  d.status = to;
}

/** Advances a delivery along a fixed timeline, so the log has life in it. */
function advance(d: Delivery, now: number) {
  const step = (seconds: number) => d.startAt + seconds * 1000;
  if (
    d.status === 'CANCELLED' ||
    d.status === 'DELIVERED' ||
    d.status === 'DEAD'
  ) {
    return;
  }
  if (d.status === 'ACCEPTED' && now >= step(0)) move(d, 'PENDING', step(0));
  if (d.status === 'PENDING' && now >= step(1.5)) {
    d.attempts += 1;
    move(d, 'CLAIMED', step(1.5));
  }
  if (d.status === 'CLAIMED' && now >= step(3)) {
    if (d.fails) {
      d.lastError = 'SMTP 550: mailbox unavailable';
      d.lastFailureClass = 'TERMINAL';
      d.attempts = d.maxAttempts;
      move(d, 'DEAD', step(3), d.lastError);
    } else {
      d.sentAt = step(3);
      move(d, 'SENT', step(3));
    }
  }
  if (d.status === 'SENT' && now >= step(5)) {
    d.deliveredAt = step(5);
    move(d, 'DELIVERED', step(5));
  }
}

function deliveryView(d: Delivery) {
  return {
    id: d.id,
    requestId: d.requestId,
    templateKey: d.templateKey,
    templateVersion: '1',
    category: d.category,
    categoryClass: d.categoryClass,
    priority: d.priority,
    channel: d.channel,
    recipientReference: d.recipientReference,
    status: d.status,
    attempts: d.attempts,
    maxAttempts: d.maxAttempts,
    createdAt: iso(d.createdAt),
    scheduledAt: d.scheduledAt ? iso(d.scheduledAt) : null,
    sentAt: d.sentAt ? iso(d.sentAt) : null,
    deliveredAt: d.deliveredAt ? iso(d.deliveredAt) : null,
    lastError: d.lastError,
    lastFailureClass: d.lastFailureClass,
    providerMessageId: d.sentAt ? `msg-${d.id.slice(-6)}` : null,
  };
}

/** Masks a recipient the way a non-PII column would show it. */
function reference(r: { userId?: string; address?: string }) {
  if (r.userId) return `user:${r.userId}`;
  const [name = '', domain = ''] = (r.address ?? '').split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}

// The subset of $filter the kit produces for deliveries.
function matches(d: Delivery, filter: string | undefined): boolean {
  if (!filter) return true;
  const clauses = filter.replace(/^\((.*)\)$/, '$1').split(/\)\s+and\s+\(/);
  return clauses.every(raw => {
    const clause = raw.replace(/^\(|\)$/g, '').trim();
    let m: RegExpMatchArray | null;
    if ((m = clause.match(/^(\w+) eq '([^']*)'$/)))
      return (
        String((deliveryView(d) as Record<string, unknown>)[m[1]!]) === m[2]
      );
    if ((m = clause.match(/^requestId eq ([\w-]+)$/)))
      return d.requestId === m[1];
    if ((m = clause.match(/^status in \((.*)\)$/)))
      return m[1]!
        .split(',')
        .map(s => s.trim().replace(/'/g, ''))
        .includes(d.status);
    if ((m = clause.match(/^createdAt (ge|le) (.+)$/))) {
      const at = Date.parse(m[2]!.replace(/'/g, ''));
      return m[1] === 'ge' ? d.createdAt >= at : d.createdAt <= at;
    }
    return true;
  });
}

// --------------------------------------------------------------- the mock

export interface PublishedAnnouncement {
  id: string;
  category: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  publishedAt: string;
  visibleFrom: string;
  visibleUntil: string;
}

/** Categories whose announcements are also emailed, as the service's
 *  category configuration would say. */
const EMAILED_CATEGORIES = new Set(['platform-incident']);

/** The service's announcement catalogue: the category decides the class. */
export const ANNOUNCEMENT_CLASS: Record<
  string,
  'TRANSACTIONAL' | 'PLATFORM' | 'MARKETING'
> = {
  'platform-incident': 'TRANSACTIONAL',
  'platform-tip': 'PLATFORM',
  'platform-release': 'MARKETING',
};

export function createAdminMock(options: {
  publish: (announcement: PublishedAnnouncement) => void;
  correct: (
    id: string,
    subject: string,
    bodyText: string,
    bodyHtml: string | null
  ) => void;
}) {
  const deliveries: Delivery[] = [];
  const requests: RequestRecord[] = [];
  const runs = new Map<string, EmailRun>();
  const published = new Map<string, Record<string, unknown>>();

  // Some history to look at.
  const SEED: Array<[string, Channel, string, Status, number]> = [
    ['welcome', 'EMAIL', 'iv***@sber.ru', 'DELIVERED', 30],
    ['welcome', 'IN_APP', 'user:u-1042', 'DELIVERED', 30],
    ['password-reset', 'EMAIL', 'pe***@sber.ru', 'DEAD', 95],
    ['password-reset', 'EMAIL', 'an***@sber.ru', 'DELIVERED', 180],
    ['platform-release', 'IN_APP', 'user:u-2001', 'DELIVERED', 300],
    ['welcome', 'CHAT', 'user:u-1077', 'SUPPRESSED', 600],
    ['password-reset', 'EMAIL', 'ol***@sber.ru', 'FAILED', 8],
    ['welcome', 'EMAIL', 'ma***@sber.ru', 'PENDING', 2],
  ];
  const now0 = Date.now();
  for (let i = 0; i < 46; i += 1) {
    const [key, channel, ref, status, minutes] = SEED[i % SEED.length]!;
    const created =
      now0 - (minutes + Math.floor(i / SEED.length) * 1440) * 60_000;
    const requestId = uuid();
    const d: Delivery = {
      id: uuid(),
      requestId,
      templateKey: key,
      category: key === 'platform-release' ? 'platform-release' : 'account',
      categoryClass: 'TRANSACTIONAL',
      priority: key === 'password-reset' ? 'HIGH' : 'NORMAL',
      channel,
      recipientReference: ref,
      status,
      attempts:
        status === 'DEAD'
          ? 5
          : status === 'FAILED'
            ? 2
            : status === 'PENDING'
              ? 0
              : 1,
      maxAttempts: 5,
      createdAt: created,
      startAt: Number.POSITIVE_INFINITY,
      sentAt: status === 'DELIVERED' ? created + 2000 : null,
      deliveredAt: status === 'DELIVERED' ? created + 4000 : null,
      scheduledAt: null,
      lastError:
        status === 'DEAD'
          ? 'SMTP 550: mailbox unavailable'
          : status === 'FAILED'
            ? 'Connection timed out'
            : null,
      lastFailureClass:
        status === 'DEAD'
          ? 'TERMINAL'
          : status === 'FAILED'
            ? 'RETRYABLE'
            : null,
      fails: false,
      history: [
        {
          from: null,
          to: 'ACCEPTED',
          occurredAt: iso(created),
          attemptNumber: null,
          detail: null,
        },
        {
          from: 'ACCEPTED',
          to: 'PENDING',
          occurredAt: iso(created + 300),
          attemptNumber: null,
          detail: null,
        },
        ...(status === 'PENDING'
          ? []
          : [
              {
                from: 'PENDING' as Status,
                to: status,
                occurredAt: iso(created + 4000),
                attemptNumber: 1,
                detail: status === 'SUPPRESSED' ? 'Адрес в стоп-листе' : null,
              },
            ]),
      ],
      subject:
        key === 'password-reset'
          ? 'Reset your password'
          : 'Welcome to Sber Data',
      textBody: 'Текст сообщения из демо-истории.',
      htmlBody: null,
      expired: i >= 20,
    };
    deliveries.push(d);
    requests.push({
      id: requestId,
      idempotencyKey: null,
      templateKey: key,
      category: d.category,
      categoryClass: d.categoryClass,
      priority: d.priority,
      createdAt: created,
      scheduledAt: null,
      deliveryIds: [d.id],
    });
  }

  const tick = () => {
    const now = Date.now();
    deliveries.forEach(d => advance(d, now));
  };

  const requestView = (r: RequestRecord, duplicate = false) => ({
    id: r.id,
    idempotencyKey: r.idempotencyKey,
    templateKey: r.templateKey,
    category: r.category,
    categoryClass: r.categoryClass,
    priority: r.priority,
    createdAt: iso(r.createdAt),
    scheduledAt: r.scheduledAt ? iso(r.scheduledAt) : null,
    state: 'ACCEPTED',
    duplicate,
    deliveries: r.deliveryIds
      .map(id => deliveries.find(d => d.id === id))
      .filter((d): d is Delivery => Boolean(d))
      .map(deliveryView),
  });

  const runView = (announcementId: string) => {
    const run = runs.get(announcementId)!;
    const now = Date.now();
    const elapsed =
      (Math.min(now, run.cancelledAt ?? now) - run.startedAt) / 1000;
    const counted = elapsed > 2;
    const completed = Math.min(
      run.total,
      Math.max(0, Math.floor((elapsed - 1) * PER_SECOND))
    );
    const finished = completed >= run.total;
    const status = run.cancelledAt
      ? 'CANCELLED'
      : finished
        ? 'SUCCEEDED'
        : elapsed < 1
          ? 'PENDING'
          : 'RUNNING';
    return {
      id: run.id,
      status,
      terminal: status === 'CANCELLED' || status === 'SUCCEEDED',
      submittedAt: iso(run.startedAt),
      startedAt: iso(run.startedAt + 1000),
      finishedAt: finished || run.cancelledAt ? iso(now) : null,
      progress: {
        phase: counted ? 'SENDING' : 'COUNTING',
        unit: 'deliveries',
        completed,
        total: counted ? run.total : null,
      },
    };
  };

  const handle = (request: TransportRequest): TransportResponse | null => {
    tick();
    const route = `${request.method} ${request.path}`;
    const query = new Map(request.query);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const now = Date.now();
    let m: RegExpMatchArray | null;

    if (route === 'POST /notifications/preview') {
      const key = String(body.templateKey);
      try {
        const result = render(
          key,
          body.channel as Channel,
          body.locale as string | undefined,
          (body.variables ?? {}) as Record<string, unknown>
        );
        if (!result) {
          return problem(
            404,
            'error.notification.template.not-found',
            'Шаблон не найден',
            `Для шаблона «${key}» нет текста в канале ${String(body.channel)}.`
          );
        }
        return json(200, result);
      } catch (error) {
        if (error instanceof RenderError) {
          return problem(
            422,
            'error.notification.template.render-failed',
            'Шаблон не отрисован',
            `Не хватает значения «${error.message}».`
          );
        }
        throw error;
      }
    }

    if (route === 'POST /notifications') {
      const key = request.headers['Idempotency-Key'] ?? null;
      const known = key
        ? requests.find(r => r.idempotencyKey === key)
        : undefined;
      if (known) return json(200, requestView(known, true));

      const templateKey = String(body.templateKey);
      const channels = body.channels as Channel[];
      const recipients = body.recipients as Array<{
        userId?: string;
        address?: string;
      }>;
      const variables = (body.variables ?? {}) as Record<string, unknown>;
      for (const channel of channels) {
        if (localesFor(templateKey, channel).length === 0) {
          return problem(
            422,
            'error.notification.template.channel-unsupported',
            'Канал не поддерживается',
            `У шаблона «${templateKey}» нет текста для канала ${channel}.`
          );
        }
        try {
          render(templateKey, channel, undefined, variables);
        } catch (error) {
          if (error instanceof RenderError) {
            return problem(
              422,
              'error.notification.template.render-failed',
              'Шаблон не отрисован',
              `Не хватает значения «${error.message}».`
            );
          }
          throw error;
        }
      }
      const scheduledAt = body.scheduledAt
        ? Date.parse(String(body.scheduledAt))
        : null;
      const record: RequestRecord = {
        id: uuid(),
        idempotencyKey: key,
        templateKey,
        category: String(body.category),
        categoryClass: String(body.categoryClass),
        priority: String(body.priority),
        createdAt: now,
        scheduledAt,
        deliveryIds: [],
      };
      recipients.forEach((recipient, ri) => {
        channels.forEach((channel, ci) => {
          const content = render(templateKey, channel, undefined, variables);
          const d: Delivery = {
            id: uuid(),
            requestId: record.id,
            templateKey,
            category: record.category,
            categoryClass: record.categoryClass,
            priority: record.priority,
            channel,
            recipientReference: reference(recipient),
            status: 'ACCEPTED',
            attempts: 0,
            maxAttempts: 5,
            createdAt: now,
            startAt: (scheduledAt ?? now) + (ri * channels.length + ci) * 400,
            sentAt: null,
            deliveredAt: null,
            scheduledAt,
            lastError: null,
            lastFailureClass: null,
            fails: (recipient.address ?? recipient.userId ?? '').includes(
              'bad'
            ),
            history: [
              {
                from: null,
                to: 'ACCEPTED',
                occurredAt: iso(now),
                attemptNumber: null,
                detail: null,
              },
            ],
            subject: content?.subject ?? null,
            textBody: content?.textBody ?? null,
            htmlBody: content?.htmlBody ?? null,
            expired: false,
          };
          deliveries.unshift(d);
          record.deliveryIds.push(d.id);
        });
      });
      requests.unshift(record);
      return json(201, requestView(record));
    }

    if ((m = route.match(/^GET \/notifications\/([0-9a-f-]{36})$/))) {
      const record = requests.find(r => r.id === m![1]);
      return record
        ? json(200, requestView(record))
        : problem(
            404,
            'error.notification.request.not-found',
            'Не найдено',
            'Запрос не найден.'
          );
    }

    if (route === 'GET /notifications/deliveries') {
      const rows = deliveries
        .filter(d => matches(d, query.get('$filter')))
        .sort((a, b) => b.createdAt - a.createdAt);
      const top = Math.min(Number(query.get('$top') ?? 25), 100);
      const skip = Number(query.get('$skip') ?? 0);
      const content = rows.slice(skip, skip + top).map(deliveryView);
      return json(200, {
        content,
        offset: skip,
        size: content.length,
        totalElements: rows.length,
      });
    }

    if (
      (m = route.match(
        /^(GET|POST) \/notifications\/deliveries\/([^/]+)(?:\/(history|content|retry|cancel))?$/
      ))
    ) {
      const [, , id, action] = m;
      const d = deliveries.find(x => x.id === id);
      if (!d)
        return problem(
          404,
          'error.notification.delivery.not-found',
          'Не найдено',
          'Доставка не найдена.'
        );
      if (!action) return json(200, deliveryView(d));
      if (action === 'history') return json(200, d.history);
      if (action === 'content') {
        if (d.expired) {
          return problem(
            410,
            'error.notification.delivery.content-expired',
            'Текст удалён',
            'Срок хранения текста истёк.'
          );
        }
        return json(200, {
          deliveryId: d.id,
          subject: d.subject,
          textBody: d.textBody,
          htmlBody: d.htmlBody,
          templateVersion: '1',
          renderedAt: iso(d.createdAt),
        });
      }
      if (action === 'retry') {
        if (d.status !== 'DEAD') {
          return problem(
            409,
            'error.notification.delivery.not-dead',
            'Нельзя повторить',
            'Повторить можно только недоставленное сообщение.'
          );
        }
        d.attempts = 0;
        d.fails = false;
        d.lastError = null;
        d.lastFailureClass = null;
        move(d, 'PENDING', now, 'Повтор вручную');
        d.startAt = now - 100;
        return json(200, deliveryView(d));
      }
      if (d.status !== 'ACCEPTED' && d.status !== 'PENDING') {
        return problem(
          409,
          'error.notification.delivery.already-sent',
          'Нельзя отменить',
          'Сообщение уже отправлено.'
        );
      }
      move(d, 'CANCELLED', now, 'Отменено вручную');
      return json(200, deliveryView(d));
    }

    if (route === 'POST /announcements') {
      const key = String(body.templateKey);
      let content;
      try {
        content = render(
          key,
          'IN_APP',
          'ru',
          (body.variables ?? {}) as Record<string, unknown>
        );
      } catch (error) {
        if (error instanceof RenderError) {
          return problem(
            422,
            'error.notification.template.render-failed',
            'Шаблон не отрисован',
            `Не хватает значения «${error.message}».`
          );
        }
        throw error;
      }
      if (!content) {
        return problem(
          422,
          'error.notification.announcement.template-unsupported',
          'Шаблон не подходит',
          `У шаблона «${key}» нет текста для показа в приложении.`
        );
      }
      const id = uuid();
      const emailed = EMAILED_CATEGORIES.has(String(body.category));
      const admin = {
        id,
        category: body.category,
        categoryClass: ANNOUNCEMENT_CLASS[String(body.category)] ?? 'MARKETING',
        audienceType: body.audienceType,
        audienceValue: body.audienceValue ?? null,
        templateKey: key,
        publishedAt: iso(now),
        publishedBy: 'demo.moderator',
        visibleFrom: body.visibleFrom ?? iso(now),
        visibleUntil: body.visibleUntil,
        emailRunId: emailed ? uuid() : null,
      };
      published.set(id, admin);
      if (emailed)
        runs.set(id, {
          id: admin.emailRunId!,
          startedAt: now,
          total: 1240,
          cancelledAt: null,
        });
      options.publish({
        id,
        category: String(body.category),
        subject: content.subject ?? '',
        bodyText: content.textBody ?? '',
        bodyHtml: content.htmlBody ?? null,
        publishedAt: admin.publishedAt,
        visibleFrom: String(admin.visibleFrom),
        visibleUntil: String(admin.visibleUntil),
      });
      return json(201, admin);
    }

    if ((m = route.match(/^POST \/announcements\/([^/]+)\/corrections$/))) {
      const admin = published.get(m[1]!);
      if (!admin)
        return problem(
          404,
          'error.notification.announcement.not-found',
          'Не найдено',
          'Объявление не найдено.'
        );
      try {
        // As the service: a correction re-renders the announcement's own
        // template; only the variables of the request are read.
        const content = render(
          String(admin.templateKey),
          'IN_APP',
          'ru',
          (body.variables ?? {}) as Record<string, unknown>
        );
        options.correct(
          m[1]!,
          content?.subject ?? '',
          content?.textBody ?? '',
          content?.htmlBody ?? null
        );
      } catch (error) {
        if (error instanceof RenderError) {
          return problem(
            422,
            'error.notification.template.render-failed',
            'Шаблон не отрисован',
            `Не хватает значения «${error.message}».`
          );
        }
        throw error;
      }
      return json(200, admin);
    }

    if (
      (m = route.match(
        /^(GET|POST) \/announcements\/([^/]+)\/email-run(\/cancellation)?$/
      ))
    ) {
      const [, , id, cancel] = m;
      const run = runs.get(id!);
      if (!run)
        return problem(
          404,
          'error.notification.announcement.no-email-run',
          'Не найдено',
          'У объявления нет рассылки.'
        );
      if (cancel) {
        run.cancelledAt ??= now;
        return json(202, runView(id!));
      }
      const view = runView(id!);
      return json(200, view, view.terminal ? {} : { 'retry-after': '1' });
    }

    return null;
  };

  return { handle };
}

/** A stand-in for the host's employee directory. */
const PEOPLE = [
  ['u-1042', 'Иванова Анна', 'Аналитик данных · a.ivanova@sber.ru'],
  ['u-1077', 'Петров Сергей', 'Владелец источника · s.petrov@sber.ru'],
  ['u-2001', 'Смирнова Ольга', 'Модератор · o.smirnova@sber.ru'],
  ['u-2002', 'Кузнецов Дмитрий', 'Инженер данных · d.kuznetsov@sber.ru'],
  ['u-2003', 'Соколова Мария', 'Аналитик · m.sokolova@sber.ru'],
  ['u-2004', 'Попов Алексей', 'Руководитель направления · a.popov@sber.ru'],
  ['u-2005', 'Лебедева Екатерина', 'Владелец источника · e.lebedeva@sber.ru'],
] as const;

export async function searchPeople(query: string, signal: AbortSignal) {
  await new Promise(resolve => setTimeout(resolve, 180));
  if (signal.aborted) return [];
  const q = query.toLowerCase();
  return PEOPLE.filter(([id, name, hint]) =>
    `${id} ${name} ${hint}`.toLowerCase().includes(q)
  ).map(([id, name, hint]) => ({
    id: `user:${id}`,
    label: name,
    userId: id,
    hint,
  }));
}
