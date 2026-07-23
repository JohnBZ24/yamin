# Cursor AI Rulebook

Authoritative checklist for every Cursor-assisted change in this repository. Read this file before writing a single line of code.

---

## 1. Core Mindset

- Mirror existing architecture exactly; no experimental folder structures or patterns.
- Prefer clarity over cleverness: explicit DTOs, explicit object parameters, explicit error types.
- Tests are required for the async/AI pipeline and the memory graph. (This rule previously said "never generate automated tests; validation comes from reasoning". That was untenable here: the pipeline is non-deterministic and concurrent, and reasoning cannot observe an ON CONFLICT target, a partial unique index, or a driver returning a different result shape per statement type. Writing the suite immediately found a real merge bug that had passed both typecheck and a live run — see §10.)
- All code must compile under the default Nest + Prettier formatting rules (2 spaces, semicolons, single quotes).

## 2. Project Layout & Modules

- Every domain lives under `src/<module>` with subfolders `domain`, `dto`, `exceptions`, `infrastructure`, `swagger`, plus the module’s controllers/services.
- **The app runs as two process types and therefore has two root modules.** `src/app.module.ts` no longer exists:
  - `src/core.module.ts` — shared by both: config, TypeORM (via `TypeOrmConfigService`), BullMQ connection, EventEmitter.
  - `src/api.module.ts` — the producer: controllers, gateway, `UserModule`, `AuthModule`, `HealthModule`. Booted by `src/main.ts`.
  - `src/worker.module.ts` — the consumer: BullMQ `@Processor`s only, no HTTP. Booted by `src/main.worker.ts`.
- **A `@Processor` must only ever be provided by a worker-side module.** Registering one is what starts a BullMQ worker, so providing it in a module the API imports silently makes the API consume jobs too and defeats the entire two-instance split. This is a real regression that already happened once.
- A domain that spans both sides splits into three modules — see `src/voice/`: `voice-infrastructure.module.ts` (entities + repositories, shared), `voice-api.module.ts`, `voice-worker.module.ts`.
- `src/main.ts` boots the API only: global prefix, URI versioning, validation pipe, interceptors (`ResolvePromises`, `ClassSerializer`, `ResponseTransform`, `ErrorHandling`), body limits, CORS, socket.io Redis adapter, shutdown hooks, Swagger. Never bypass or duplicate this logic elsewhere.
- New config must be a namespaced `registerAs` module with a `validateConfig` env validator, listed in `CoreModule`'s `load` array and added to `AllConfigType`. Never read `process.env` / `configService.get('SOME_RAW_VAR')` directly in a service.

## 2b. The memory graph

- **The LLM never invents vocabulary.** Entity types and relation types come from the enums in `src/voice/domain/graph-vocabulary.ts`, passed to the model as a JSON-schema `enum`. A free-form `label` string produced `Organization:Acme Corp` and `Company:Acme Corp` for the same company on two runs, and the graph silently stopped joining.
- **Nodes are canonical per user, not per note.** Resolution key: `(userId, type, normalizedName)` via `EntityNodeRepository.resolve()`, which is a single `INSERT ... ON CONFLICT` — never SELECT-then-INSERT, which loses the race between concurrent workers and fails a job whose retry re-bills the embedding and both LLM calls.
- **Extraction is given the user's existing entities** (`findLinkingCandidates`) so it links rather than coins. Skipping this fragments one thing into "pricing page" / "Pricing Page" / "Pricing Page Completion".
- **Provenance lives in `node_mention`**, never on the node.
- **Every memory read is scoped by `userId` inside the SQL**, not filtered afterwards. This is the authorization boundary for the most sensitive data in the product.
- Counters (`mentionCount`) must be incremented only when a row is genuinely inserted, or a BullMQ retry inflates them.

## 3. Controllers

- Any controller that touches the database **must**:
  - be decorated with `@UseInterceptors(QueryRunnerInterceptor)`;
  - request a `QueryRunner` parameter via `@TransactionQueryRunner()`;
  - pass that runner to every service call that ultimately hits the database.
- Authentication/authorization:
  - Apply `@UseGuards(JwtAuthGuard, RolesGuard)` when a route needs auth. Layer `@Roles(RoleEnum.*)` as needed (`user.admin.controller.ts` is the reference).
  - Extract the current user ID with `@GetUser()`; throw `UnauthorizedException` when the decorator cannot resolve an ID.
- Responsibility split:
  - Controllers validate DTOs and turn service return values into HTTP responses.
  - They perform `findOne` existence checks and throw custom `UserNotFoundException` (or equivalent) before returning `null` to the client.
  - They never build query builders or repositories directly.

## 4. Services

- Services orchestrate validation + repository calls. Accept parameters as **one object argument** containing named properties `{ id, updateUserDto, queryRunner, relationsAndSelects }`.
- Always pass the `queryRunner` you receive (even if `undefined`) to every repository interaction so that all work stays in the interceptor-managed transaction.
- Service-level guards are allowed for mutations: double-check invariants (e.g., email uniqueness) and throw the module’s custom exceptions.
- `findOne`-style methods should simply return `User | null`, letting controllers decide how to translate absence into HTTP errors.
- Password hashing or similar utilities live in private helpers (`hashPassword`) that stay runner-agnostic.

## 5. Repositories

- Resolve the correct TypeORM repository through `getRepository(queryRunner)` so transactions remain scoped to the HTTP request.
- `findManyWithPagination` flow (`user.repository.ts` reference):
  - Build `createQueryBuilder('user')`.
  - Await `addRelationsAndSelects` to apply select lists and joins.
  - Layer filters (case-insensitive `ILIKE` for strings), sorts (default `createdAt DESC`), and pagination (`skip`/`take`) before `getManyAndCount`.
  - Return `{ data, totalCount }` after mapping through the domain mapper.
- `findOne` builds where clauses only for received fields and returns `null` without throwing.
- `update` uses `preload` + `save` to merge partial payloads and returns `null` when the entity is missing; callers decide which exception to raise.
- `softDelete` receives `{ id, queryRunner }` and calls TypeORM’s `softDelete`.

## 6. DTOs, Filters, Sort, Pagination

- Use `class-transformer` + `class-validator` to coerce/validate query parameters (`QueryUserDto` is the template).
  - Filters arrive as JSON strings, parse to typed DTOs.
  - Sort definitions accept `{ orderBy, order }`; default to `createdAt DESC` when absent.
  - Pagination defaults: `page = 1`, `limit = 10`, `limit ≤ 50`. Modules may override but must document the change.
- Transform results to API payloads with helpers from `src/utils/helpers/infinity-pagination.ts`.

## 7. QueryRunner & Transactions

- `QueryRunnerInterceptor` (global) creates, starts, commits/rolls back, and releases a TypeORM `QueryRunner` per HTTP request; it logs every phase with Nest’s `Logger`.
- `TransactionQueryRunner` decorator simply retrieves `request.queryRunner`; never instantiate query runners manually inside controllers/services.
- For out-of-request workflows (scripts, cron jobs) reuse `safeTransaction` / `safeRelease` from `src/utils/queryRunner`.

## 8. Relations & Select Profiles

- Define select/join presets in `src/<module>/infrastructure/relations-and-selects-options.ts`.
- The `RelationsAndSelectsOptions` shape (`select: string[]`, `joins: JoinDefinition[]`) powers `add-relations-and-selects.ts`.
- All repository read methods accept `relationsAndSelects?: RelationsAndSelectsOptions` and **must** feed them into `addRelationsAndSelects`.
- Use module defaults (`userFindManyDefault`, `userFindOneDefault`) unless a feature explicitly requires more columns or joins (as seen in `userFindOneAuthLogin` for Auth).

## 9. Auth Module

- `AuthController` exposes `POST /auth/email/login` and `POST /auth/refresh`. These endpoints are stateless (no query runner) but still rely on DTO validation + Swagger decorators.
- `AuthService.validateLogin`:
  - Fetches the user via `userService.findOneByEmail` with the `userFindOneAuthLogin` select profile.
  - Verifies passwords with `bcrypt.compare`, throws `AuthUserNotFound` or `AuthIncorrectPassword` accordingly.
  - Generates access + refresh tokens through `JwtService`, reading secrets/expirations from `ConfigService<AllConfigType>`.
- `refreshToken` validates the refresh JWT, ensures the user still exists, and issues new tokens; errors map to `AuthInvalidRefreshToken`.

## 10. Configuration Layer

- Each config namespace (`app`, `auth`, `database`) uses `registerAs` + `validate-config.ts`, enforcing environment variable schemas with `class-validator`.
- Access config via `ConfigService<AllConfigType>` and `{ infer: true }` to benefit from typing.
- `app.config.ts` distinguishes test vs. non-test defaults (ports, backend domain, API prefix).
- `auth.config.ts` and `database.config.ts` ensure all required credentials exist before Nest boots; never bypass validation.

## 11. Database, Seeds & Scripts

- TypeORM options come from `TypeOrmConfigService`: CamelCase naming, connection pooling, SSL options, entity/migration globs, no schema drops.
- Seeders live under `src/database/seeds/relational`. Boot them via Nest modules (`SeedModule`) and services (`UserSeedService`) that inject repositories.
- `UserSeedService` pattern:
  - Hash seed passwords with `bcrypt`.
  - Idempotently create default users (super admin, admin, regular) while tolerating duplicates (`23505`).
- Scripts (e.g., `src/database/scripts/seedLocal.js`) run npm seed commands with environment overrides. Follow this approach for future automation.

## 12. Utilities, Decorators & Interceptors

- Decorators: `GetUser`, `GetVerifiedTokenData`, `TransactionQueryRunner`. Keep them stateless and reuse across modules.
- Interceptors:
  - `ResolvePromisesInterceptor` resolves pending promises before serialization.
  - `ResponseTransformInterceptor` wraps responses in `{ status, data }`, unless `data` already exists.
  - `ErrorHandlingInterceptor` funnels errors to `handleError` for consistent exception formatting.
- Helpers: `deepResolvePromises`, pagination helpers, `EntityRelationalHelper`, etc. Prefer consuming them over reinventing logic.

## 13. Error Handling & Logging

- Always throw module-specific custom exceptions (`user/exceptions`, `auth/exceptions`). Extend Nest HTTP exceptions to set statuses/messages.
- `handleError` differentiates between `HttpException`, `QueryFailedError`, and unexpected errors, logging with Nest’s `Logger`. Use this mechanism rather than ad-hoc error handling.
- When logging manually, instantiate `new Logger(ClassName)` and stick to `logger.debug/info/warn/error`; avoid `console.log` unless an existing helper already does so (and consider refactoring later).

## 14. Workflow & Tooling Expectations

- **Allowed terminal commands**: reading, listing, searching, file/folder creation, running non-destructive scripts. Never run destructive commands (`git reset --hard`, dropping DB, etc.) without explicit user approval.
## 10. Testing

- `npm test` — unit suite. No Postgres, no Redis, no API key, so it runs anywhere including CI. Never let it depend on a service.
- `npm run test:int` — integration suite (`*.int-spec.ts`) against a real Postgres. Needs `docker compose up -d postgres && npm run migration:run`.
- `npm run test:all` — both.

Rules learned the hard way:
- **Anything expressed in SQL must be tested against a real database.** Every memory-graph bug so far lived in SQL — the merge's unique-constraint violation, the mention collision, TypeORM returning `[rows, count]` for `UPDATE ... RETURNING` but `[rows]` for `INSERT ... RETURNING`. A mocked repository passes through all of them.
- **Test idempotency explicitly.** BullMQ retries re-run the whole processor, so "does running this twice change the data?" is a real question with a real answer.
- **Test the refusals.** `/memory/ask` returning "I don't know" with no context is a product guarantee, not an edge case.
- **Test user scoping.** Cross-user leakage is the worst possible bug here; assert that an identical query returns another user's rows to them and nothing to you.
- Integration suites create their own user and delete it in `afterAll` — the FK cascade cleans up everything else. Never assume an empty database, and never truncate shared tables.
- **Documentation scope**: whenever you describe or implement a feature, reference the relevant support layers (seeds, utils, auth, config, database, decorators, interceptors, `main.ts`, `main.worker.ts`, `core.module.ts`, `api.module.ts`, `worker.module.ts`) so future maintainers know the ripple effects.
- **Deliverables**: responses must explain the “what” and “why,” reference touched files, cite code snippets when clarifying behavior, and suggest follow-up validations (running scripts, etc.).

---

Keep this rulebook open while working. Every PR, task, or bugfix must cite the sections above so reviewers know requirements were followed.
