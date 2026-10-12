# notifications-kit

Клиент сервиса уведомлений и интерфейс поверх него: колокольчик, лента,
просмотр уведомления, объявления (баннеры). Версия 0.1.

Папка самодостаточна: её можно перенести в проект целиком. Внутри нет
импортов из приложения, HTTP-клиента и UI-библиотек.

Зависимости, которые должны быть в проекте:
`react` 18, `react-dom` 18, `@tanstack/react-query` 5, `zod` 4.
Сборщик должен понимать CSS-модули (`*.module.css`).

## Устройство

```
core/      контракт, клиент, ошибки, повторы, OData — без React
  generated/   схемы и таблица операций, собраны из OpenAPI; руками не править
react/     провайдер, хуки, компоненты, стили
```

## Подключение

### 1. Транспорт

Кит не делает запросы сам. Ему передают функцию, которая выполняет один
запрос и **возвращает ответ при любом статусе**: по телу ошибки кит читает
стабильный `code`. Перехватчик, который превращает 4xx/5xx в исключение или
переписывает тело, для этой функции не подходит — нужен отдельный экземпляр
клиента.

```ts
import axios from 'axios';
import type { NotificationsTransport } from '@/lib/notifications-kit';

const http = axios.create({
  baseURL: '/api/notifications', // префикс, под которым сервис стоит за шлюзом
  validateStatus: () => true, // статус разбирает кит
});

export const transport: NotificationsTransport = async request => {
  const response = await http.request({
    method: request.method,
    url: request.path, // '/api/v1/inbox/…' — путь из контракта
    params: new URLSearchParams(request.query.map(([k, v]) => [k, v])),
    headers: request.headers,
    data: request.body,
    signal: request.signal,
  });
  return {
    status: response.status,
    headers: response.headers as Record<string, string>,
    data: response.data,
  };
};
```

Если запрос не дошёл (сеть, таймаут, отмена), функция должна выбросить
исключение — как это и делает axios.

### 2. Провайдер

```tsx
import {
  AnnouncementsHost,
  NotificationsProvider,
  createNotificationsApi,
  presentationByCategory,
} from '@/lib/notifications-kit';

const api = createNotificationsApi({
  transport,
  acceptLanguage: () => i18n.language,
});

const resolvePresentation = presentationByCategory(
  { 'platform-incident': 'modal', 'platform-release': 'corner' },
  'corner'
);

<QueryClientProvider client={queryClient}>
  <NotificationsProvider
    api={api}
    locale='ru'
    enabled={isSignedIn}
    resolvePresentation={resolvePresentation}
  >
    <App />
    <AnnouncementsHost />
  </NotificationsProvider>
</QueryClientProvider>;
```

`api` и функции, передаваемые в провайдер, создаются один раз (вне
компонента или через `useMemo`/`useCallback`).

### 3. Компоненты

| Компонент                                     | Что это                                                              | Основные пропсы                                       |
| --------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| `NotificationBell`                            | Кнопка в шапке: счётчик и выпадающий список                          | `onOpenItem`, `onOpenAll`, `limit`                    |
| `InboxPanel`                                  | Лента целиком: фильтр, «Прочитать все», строки, «Показать ещё»       | `onOpenItem`, `pageSize`, `showBar`                   |
| `InboxTabs`, `MarkAllReadButton`, `InboxList` | Те же части по отдельности — чтобы разложить по зонам своей страницы | —                                                     |
| `InboxItemView`                               | Одно уведомление с темой и текстом                                   | `id`, `autoMarkRead`, `onDismissed`                   |
| `AnnouncementsHost`                           | Объявления поверх страницы; монтируется один раз                     | `toastDurationMs`, `toastOnTimeout`, `cornerPosition` |

Навигации в ките нет: куда вести по клику, решает приложение через
`onOpenItem` и `onOpenAll`.

Хуки для своих компонентов: `useUnreadCount`, `useUnreadBadge`,
`useInboxList`, `useInboxItem`, `useInboxCommands`, `useAnnouncements`,
`useOutstandingAnnouncementCount`, `useDismissAnnouncement`.
`useUnreadBadge()` возвращает `number | undefined` — в форме, удобной для
бейджа пункта меню.

## Объявления: три вида показа

Сервис сообщает, **что** это за объявление (`category`, `categoryClass`), и
не имеет поля «как показывать». Вид выбирает приложение функцией
`resolvePresentation`; готовый вариант — `presentationByCategory`.

| Вид      | Как выглядит                                                                                 | Что делает закрытие                              |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `modal`  | Диалог поверх страницы, пока не нажата «Понятно». Несколько — по одному, от старого к новому | «Понятно» → `dismiss` в сервисе                  |
| `corner` | Небольшая карточка в углу, до трёх одновременно                                              | «×» → `dismiss` в сервисе                        |
| `toast`  | Полоса сверху по центру на несколько секунд                                                  | «×» → `dismiss`. По истечении времени — см. ниже |
| `none`   | Поверх страницы не показывается                                                              | —                                                |

У `toast` конец времени по умолчанию **не** считается прочтением: полоса
скрывается до закрытия вкладки браузера, сервис продолжает считать
объявление непросмотренным, и в новой сессии оно появится снова — пока не
закрыто крестиком или не истёк срок показа. Чтобы истечение времени
закрывало объявление насовсем: `<AnnouncementsHost toastOnTimeout='dismiss' />`.

Карточки `corner` стоят в правом верхнем углу и могут закрывать кнопки
страницы под собой. Положение меняется пропом `cornerPosition='bottom-end'`
или переменными `--nk-overlay-top`, `--nk-overlay-inline`,
`--nk-overlay-bottom`.

HTML-тело (`bodyHtml`) кит сам в страницу не вставляет. Без пропа
`renderHtml` показывается текстовое тело. Чтобы показывать HTML, передайте в
провайдер свой рендерер с очисткой.

## Темы

Все цвета, отступы и радиусы — CSS-переменные `--nk-*` со значениями по
умолчанию. Приложение объявляет нужные один раз, например в `:root` и в
блоке тёмной темы:

```css
:root {
  --nk-font: var(--font-text);
  --nk-color-text: var(--clr-text-base);
  /* … */
}
```

| Переменная                                                       | Назначение                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `--nk-font`                                                      | Гарнитура                                                    |
| `--nk-font-size-caption`, `-label`, `-body`, `-title`            | 12 / 13 / 14 / 16 px                                         |
| `--nk-color-text`, `--nk-color-text-muted`                       | Основной и второстепенный текст                              |
| `--nk-color-surface-raised`                                      | Фон выпадающих панелей, карточек, диалога                    |
| `--nk-color-surface-hover`                                       | Подсветка строки, фон переключателя                          |
| `--nk-color-border`, `--nk-color-border-strong`                  | Границы                                                      |
| `--nk-color-accent`, `--nk-color-on-accent`                      | Главная кнопка, отметка «не прочитано»                       |
| `--nk-color-accent-text`, `--nk-color-accent-soft`               | Текст-ссылка, фон метки                                      |
| `--nk-color-badge`, `--nk-color-on-badge`                        | Счётчик на колокольчике                                      |
| `--nk-color-scrim`                                               | Затемнение под диалогом                                      |
| `--nk-shadow`                                                    | Тень всплывающих поверхностей                                |
| `--nk-radius-sm`, `-md`, `-lg`                                   | 8 / 10 / 14 px                                               |
| `--nk-space-xs`, `-sm`, `-md`, `-lg`, `-xl`                      | 4 / 8 / 12 / 16 / 24 px                                      |
| `--nk-control-height`                                            | Высота кнопок, 32 px                                         |
| `--nk-z-overlay`                                                 | Слой объявлений; выпадающий список колокольчика — на 10 выше |
| `--nk-overlay-top`, `--nk-overlay-inline`, `--nk-overlay-bottom` | Отступы объявлений от краёв окна                             |

## Тексты

Встроены словари `ru` и `en`; выбор — по `locale`. Отдельные строки
заменяются пропом `messages`, весь механизм — пропом `translate`. Ключи —
в `react/messages.ts`.

Подписи строк ленты по `templateKey`/`category` даёт приложение через
`describeItem` (см. «Ограничения»).

## Ошибки и повторы

Любая ошибка кита — `NotificationsError` с полем `kind`:

- `problem` — сервис ответил не 2xx; доступны `status`, `code`, `title`,
  `detail`, `traceId`, `retryAfterMs`. Ветвиться нужно по `code`;
- `network` — ответа не было;
- `contract` — ответ 2xx не совпал со схемой, либо тело запроса не прошло
  ограничения контракта (тогда запрос не отправляется).

Что повторяется автоматически:

| Что                                        | Повторы                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| Чтение                                     | до 2, если ответа не было или статус 408, 429, 502, 503, 504 |
| `seen`, `read`, «прочитать все», `dismiss` | 1 — по контракту они идемпотентны                            |
| Публикация, исправление, отправка          | никогда                                                      |

Пауза — из `Retry-After`, если сервис его прислал, иначе 1 с, 2 с, 4 с…
(не больше 30 с). Отправка уведомления (`api.requests.submit`) безопасна к
повтору только с `idempotencyKey`.

## Ограничения, которые идут от API

- **В списке нет темы и текста.** `GET /inbox` отдаёт строки без `subject`.
  По умолчанию кит догружает тему каждой видимой строки отдельным запросом
  и хранит её в кэше. Отключается: `subjects='none'` — тогда строка
  подписана тем, что вернул `describeItem`.
- **Нет push-канала.** Счётчик опрашивается: раз в 60 с и при возврате на
  вкладку (`polling.unreadCountMs`). Объявления — раз в 5 минут.
- **«Увидено» отправляется по одному.** Пакетной команды нет, поэтому на
  каждую впервые показанную строку уходит свой `POST …/seen`. Отключается:
  `markSeen={false}`.
- **Нет настроек подписок и списка шаблонов** — в контракте таких операций
  нет, в ките их тоже нет.

## Что есть в `core` сверх интерфейса 0.1

`createNotificationsApi` покрывает все операции контракта: публикацию и
исправление объявлений, прогресс и отмену email-рассылки, отправку и
предпросмотр, историю доставок, стоп-лист. Интерфейса для них в 0.1 нет.
