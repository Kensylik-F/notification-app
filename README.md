# notification-app

Здесь разрабатывается `notifications-kit` — библиотека для сервиса
уведомлений: типизированный клиент строго по его OpenAPI и интерфейс на
React. В проект переносится одна папка: `src/notifications-kit/`.

Как подключать — в [src/notifications-kit/README.md](src/notifications-kit/README.md).
Пошаговый перенос в приложение — в [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Что в репозитории

| Путь                            | Что это                                                  | Переносится в проект |
| ------------------------------- | -------------------------------------------------------- | -------------------- |
| `src/notifications-kit/`        | Библиотека                                               | да, целиком          |
| `contract/`                     | Копия OpenAPI сервиса и её источник                      | нет                  |
| `scripts/generate-contract.mjs` | Генератор схем и таблицы операций                        | нет                  |
| `tests/`                        | Проверка, что сгенерированный код совпадает с контрактом | нет                  |
| `demo/`                         | Демо на имитации сервиса                                 | нет                  |
| `scripts/screenshots.mjs`       | Снимки демо в Chromium                                   | нет                  |

## Команды

```bash
npm install
npm run check      # генерация + типы + тесты + форматирование
npm run demo       # http://localhost:5199
npm run shots      # снимки состояний демо в ./shots
```

`npm run shots` ищет Chromium по `CHROMIUM_PATH`.

## Версии

Зависимости закреплены на тех же версиях, что в приложении-потребителе:
`react` 18.3.1, `@tanstack/react-query` 5.90.16, `zod` 4.3.6,
`typescript` ~5.6.2, `vitest` 2.1.9.

## Строгость к контракту

- Схемы и таблица операций (`core/generated`) собираются скриптом из
  `contract/notification-service.openapi.yaml`. Руками они не пишутся.
- Тест `tests/contract-drift.test.ts` падает, если сгенерированные файлы
  разошлись с документом или в таблице операций есть что-то, чего нет в
  документе (и наоборот).
- Пути, параметры и тела запросов берутся только из этой таблицы.

Как обновить контракт — в [contract/SOURCE.md](contract/SOURCE.md).
