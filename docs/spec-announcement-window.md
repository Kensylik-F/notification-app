# Доработка notification-service: срок показа объявления

Для Андрея. Нужен один эндпоинт: изменить срок показа опубликованного объявления. Им же объявление снимают с показа — ставят окончание в прошлое (кит ставит конец вчерашнего дня).

Сейчас этого сделать нельзя: `POST /api/v1/announcements/{id}/corrections` берёт из тела только `variables`, а `visibleFrom` и `visibleUntil` игнорирует. Отозвать или удалить объявление тоже нечем.

## Эндпоинт

`POST /api/v1/announcements/{id}/window`

Права — те же, что у `corrections`.

Тело — `AnnouncementWindowRequest`:

| Поле | Тип | Обязательно | Смысл |
|---|---|---|---|
| `visibleUntil` | `date-time` | да | Новое окончание показа |
| `visibleFrom` | `date-time` | нет | Новое начало. Нет поля — начало не меняется |

Ответ `200` — `AnnouncementAdmin` с новыми `visibleFrom` и `visibleUntil`.

## Правила

1. **`visibleUntil` ≤ now — снять с показа.**
   - `visibleUntil` сохраняется как есть.
   - Если текущее начало позже `visibleUntil`, начало становится равным `visibleUntil`.
   - `visibleFrom` из тела в этом случае не проверяется.
   - Объявление сразу пропадает из `GET /announcements` у всех.
   - `GET /announcements/{id}` по-прежнему отдаёт его адресатам — для истории.
   - Если у объявления идёт email-рассылка, она отменяется, как `POST /{id}/email-run/cancellation`.
2. **`visibleUntil` > now — обычная правка срока.**
   - Должно выполняться `начало < visibleUntil`.
   - Длина окна — не больше `notification.announcements.max-visibility-days` (90), как при публикации.
   - Начало можно перенести и в прошлое, и в будущее.
3. **Закрытия пользователей сохраняются.** Продление срока не возвращает объявление тем, кто его закрыл.
4. **Повторный вызов с тем же телом** даёт тот же результат.
5. **Аудит** — как у `corrections`: кто, когда, старое и новое окно.

## Ошибки (ProblemDetail, `code`)

| HTTP | `code` | Когда |
|---|---|---|
| 400 | `error.validation` | Нет `visibleUntil` или дата не разбирается (`violations`) |
| 404 | `error.notification.announcement.not-found` | Нет такого объявления |
| 422 | `error.notification.announcement.window-invalid` | Окончание в будущем и не позже начала |
| 422 | `error.notification.announcement.window-too-long` | Окно длиннее `max-visibility-days` |

## Примеры

Снять с показа:

```http
POST /api/v1/announcements/7c3f1d2e-…/window
{ "visibleUntil": "2026-10-26T20:59:00Z" }
```

Продлить и сдвинуть начало:

```http
POST /api/v1/announcements/7c3f1d2e-…/window
{ "visibleFrom": "2026-10-28T06:00:00Z", "visibleUntil": "2026-11-10T20:59:00Z" }
```

## Что уже есть в ките

- Операция в контракте кита (`contract/notification-service.openapi.yaml`) помечена `x-kit-status: proposed`.
- UI готов: «Срок показа» и «Снять с показа» в окне правки.
- Мок демо реализует правила выше.
- Пока эндпоинта в сервисе нет, кит показывает «Сервис уведомлений пока не умеет менять срок показа». Текст объявления при этом сохраняется.
