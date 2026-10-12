# Источник контракта

`notification-service.openapi.yaml` — копия документа из репозитория сервиса:

- репозиторий: https://github.com/LudwigAndreas/java-ludwig-common
- путь: `docs/api/notification-service.openapi.yaml`
- коммит: `0a68e84ed9e36d72ee8c1ef5241aed2b4ddcbf52` (2026-10-11)

Документ генерируется из кода сервиса и проверяется его сборкой, поэтому
здесь он не редактируется. Чтобы перейти на новую версию API:

1. заменить файл новой копией и обновить коммит выше;
2. `npm run generate` — пересоберёт `src/notifications-kit/core/generated`;
3. `npm run check` — покажет, что в ките перестало сходиться с контрактом.

Второй документ того же репозитория, `crud-service-example.openapi.yaml`,
описывает другой сервис. Из него взяты только общие соглашения платформы,
которые в контракте уведомлений те же: конверт страницы, пять OData-опций,
RFC 9457 для ошибок, конверт долгой операции.

## Шаблоны

`contract/templates/` — копия каталога шаблонов сервиса на том же коммите:
`services/notification-service/src/main/resources/templates/`. Из него
`npm run generate` собирает `src/notifications-kit/core/generated/templates.ts`:
ключи, каналы, языки и переменные шаблонов. При переходе на новый коммит
каталог заменяется вместе с OpenAPI.

## Прочее

Права модераторских экранов взяты из `@PreAuthorize` контроллеров
(`web/NotificationController`, `DeliveryAdminController`,
`AnnouncementAdminController`) на том же коммите.

Помимо контракта из исходников сервиса на том же коммите взяты три вещи,
которых в OpenAPI нет: список кодов ошибок (`core/errors.ts`), имена сущностей
для `filter-metadata` и лимиты страниц (`core/odata.ts`). Они помечены в коде.
