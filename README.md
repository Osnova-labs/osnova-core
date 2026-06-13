# osnova-core

Общие TypeScript-пакеты для папок проекта Osnova.

## Статус

Стартовая основа core-пакетов.

## Лицензия

MIT.

## Пакеты

- `@osnova/types`: общие доменные типы.
- `@osnova/manifest`: создание и чтение manifest.
- `@osnova/validation`: валидация manifest и структуры проекта.
- `@osnova/project`: создание и открытие папки проекта, операции с конспектами.

## Команды

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Связанные репозитории

- `osnova-spec` определяет формат проекта, реализуемый здесь.
- `osnova-desktop` использует project и validation APIs.
- `osnova-plugin-sdk` может переиспользовать общие типы для plugin APIs.

## Правила участия

Границы пакетов должны оставаться небольшими. Стабильные доменные контракты размещаются в `@osnova/types`, операции с диском - в `@osnova/project`, manifest-specific логика - в `@osnova/manifest`, проверки - в `@osnova/validation`.
