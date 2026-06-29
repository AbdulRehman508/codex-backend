# Project structure & conventions

Follow this layout for every new feature. Consistency > cleverness.

```
src/
  main.ts                 # bootstrap only: prefix, body parser, swagger, listen
  app.module.ts           # root wiring + global APP_GUARD/FILTER/INTERCEPTOR/PIPE

  config/
    configuration.ts      # typed env -> nested config object (config.get('jwt.secret'))
    env.validation.ts     # class-validator schema; app refuses to boot on bad env

  common/                 # cross-cutting, feature-agnostic. NEVER import a feature here.
    decorators/           # @Public(), future @CurrentUser()
    filters/              # AllExceptionsFilter -> { success:false, message, errors }
    interceptors/         # ResponseInterceptor -> { success, message, data }
    pipes/                # buildValidationPipe -> 400 { message, errors:{field:[]} }
    storage/              # StorageModule + StorageService (base64 -> disk URL)

  database/               # mongoose connection (DataBaseModule + config service)

  modules/                # one folder per feature, self-contained
    auth/
      auth.module.ts
      guards/jwt-auth.guard.ts
    office/
      dto/                # request shape + validation (create/update/query/bulk)
      schemas/            # mongoose schema (DB shape)
      office.controller.ts
      office.service.ts   # all business logic + DB access
      office.module.ts
```

## Layer rules

- **Controller** — HTTP only: route, param/body binding, call service, return `{ message, data }`. No business logic, no DB.
- **Service** — business logic + DB access. Throws Nest exceptions (`NotFoundException`, `ConflictException`, ...).
- **DTO** — what the client sends; validated by `class-validator`. Input shape, *not* DB shape.
- **Schema** — what Mongo stores. `_id -> id` transform, `deleted_at` soft delete, timestamps.
- **common/** — reusable, no feature imports. A feature may import `common/`, never the reverse.

## Cross-cutting is global (wired once in `app.module.ts`)

| Concern | Provider | Effect |
|---------|----------|--------|
| Auth | `APP_GUARD: JwtAuthGuard` | every route needs Bearer JWT |
| Validation | `APP_PIPE: buildValidationPipe` | bad DTO -> 400 with field errors |
| Success shape | `APP_INTERCEPTOR: ResponseInterceptor` | `{ success, message, data }` |
| Error shape | `APP_FILTER: AllExceptionsFilter` | `{ success:false, message, errors? }` |

Auth is **on by default**. Public routes opt out:

```ts
import { Public } from 'src/common/decorators/public.decorator';

@Public()
@Post('login')
login() {}
```

## Adding a new feature (recipe)

1. `src/modules/<name>/` with `dto/`, `schemas/`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.module.ts`.
2. Register schema via `MongooseModule.forFeature` in the feature module.
3. Import the feature module in `app.module.ts`.
4. Controller returns `{ message, data }` — global interceptor wraps it.
5. Need files? import `StorageModule`. Need config? inject `ConfigService`, read `config.get('...')`.

## Env

All required env declared in `config/env.validation.ts`. Missing/invalid -> boot fails with a clear message. Add a new var there + in `configuration.ts` before using it.
