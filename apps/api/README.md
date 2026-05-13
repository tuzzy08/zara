# Zara API

The NestJS API starts with a small, production-shaped module layout:

- `src/app.module.ts`: root application module
- `src/health/health.module.ts`: health surface module
- `src/health/health.controller.ts`: health endpoint
- `src/main.ts`: application bootstrap

Additional domains should be added as focused feature modules instead of growing `AppModule` into a catch-all file.

