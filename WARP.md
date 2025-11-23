# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project overview

Node.js/Express API for user acquisition/authentication backed by PostgreSQL via Neon and Drizzle ORM. The app exposes health and API endpoints, handles signup/signin/signout flows, and secures traffic with Arcjet-based security middleware.

Key technologies:

- Node 18+, ES modules (`"type": "module"`)
- Express 5
- PostgreSQL via Neon (serverless) + Drizzle ORM
- Arcjet for bot protection, shielding, and rate limiting
- Zod for request validation
- Winston + Morgan for structured logging

## Local development

### Using Node directly

From the repo root:

- Install dependencies: `npm ci`
- Run the app in dev mode with file watching: `npm run dev`
- Run the app in production mode (no watch): `npm start`

The main entrypoint is `src/index.js`, which loads environment variables via `dotenv/config` and starts the HTTP server from `src/server.js`.

### Using Docker (recommended when working with the database)

This project has separate Docker Compose setups for development (with Neon Local) and production-like runs.

- Start dev stack (app + Neon Local):
  - `docker-compose -f docker-compose.dev.yml up --build`
- Stop dev stack:
  - `docker-compose -f docker-compose.dev.yml down`
- Start production stack (app only, expects a cloud-hosted Neon/Postgres):
  - `docker-compose -f docker-compose.prod.yml up --build -d`
- Stop production stack:
  - `docker-compose -f docker-compose.prod.yml down`

Dev compose expects `.env.development`; prod compose expects `.env.production`. The development stack exposes the app on `${PORT:-3000}` and Postgres (Neon Local) on `5432`.

## Linting and formatting

From the repo root:

- Lint entire project: `npm run lint`
- Lint and automatically fix issues: `npm run lint:fix`
- Format code with Prettier: `npm run format`
- Check formatting only (no writes): `npm run format:check`

## Testing

Jest is configured as the test runner via the `test` script.

- Run the full test suite: `npm test`
- Run a single test file:
  - `npm test -- path/to/your.test.js`
- Run tests matching a name pattern:
  - `npm test -- --testNamePattern="pattern"`

On Node 18+ this uses `NODE_OPTIONS=--experimental-vm-modules` to allow Jest with ESM.

## Database and migrations

PostgreSQL access is via Neon (serverless) and Drizzle ORM.

- Generate Drizzle SQL/migrations (from schema): `npm run db:generate`
- Apply migrations: `npm run db:migrate`
- Open Drizzle Studio (web UI): `npm run db:studio`

`src/config/database.js` configures Neon differently for development vs other environments:

- In `NODE_ENV=development`, it routes to the Neon Local proxy (`neon-local` service in `docker-compose.dev.yml`).
- Otherwise it uses the `DATABASE_URL` directly (expected to point at a Neon/Postgres instance).

## High-level architecture

### Entry points and HTTP surface

- `src/index.js`: loads environment variables and imports `src/server.js`.
- `src/server.js`: reads `PORT` (default 3000) and calls `app.listen(...)`.
- `src/app.js`: constructs the Express app, wires global middleware, and registers routes.

Important routes:

- `GET /`: simple text response to verify the app is up.
- `GET /health`: JSON healthcheck used by Docker health checks.
- `GET /api`: simple JSON to indicate the API is running.
- `app.use('/api/auth', authRoutes)`: authentication routes.
- `app.use('/api/users', usersRoutes)`: user CRUD-related routes.

### Routing, controllers, and services

Layering is fairly standard:

- Routes (`src/routes/*.routes.js`) attach HTTP paths to controller functions.
  - `auth.routes.js` → `signup`, `signin`, `signout` in `auth.controller.js`.
  - `users.routes.js` → `fetchAllUsers` in `users.controller.js` (plus placeholder handlers for single-user routes).
- Controllers (`src/controllers/*.controller.js`) handle HTTP concerns:
  - Validate incoming payloads using Zod schemas from `src/validations/auth.validation.js`.
  - Call into services for business logic and data access.
  - Translate domain errors to HTTP responses (e.g., 400 for validation, 401/409 for auth errors).
- Services (`src/services/*.js`) encapsulate domain logic and persistence:
  - `auth.service.js` handles password hashing, user creation, and credential verification.
  - `users.services.js` handles read operations over the `users` table.

### Data layer (Drizzle + Neon)

- `src/config/database.js` creates the Neon SQL client and wraps it with Drizzle, exporting `db`.
- `src/models/user.model.js` defines the `users` table schema via `pgTable` (id, name, email, password, role, timestamps).
- Services import `db` and `users` to perform typed queries (e.g., `db.select().from(users).where(...)`).

When changing schema:

- Update `src/models/user.model.js`.
- Regenerate migrations (`npm run db:generate`) and then apply them (`npm run db:migrate`).

### Validation and utilities

- `src/validations/auth.validation.js`: Zod schemas for sign-up and sign-in payloads.
- `src/utils/format.js`: helper to turn Zod errors into a human-readable string.
- `src/utils/jwt.js`: wraps `jsonwebtoken` with `jwttoken.sign`/`jwttoken.verify`, using `JWT_SECRET` and a `1d` expiry.
- `src/utils/cookies.js`: centralizes cookie options (HTTP-only, secure in production, strict same-site, 15-minute lifetime) and exposes helpers to set/clear cookies on responses.

### Security and rate limiting

Security is primarily handled by an Arcjet-based middleware and HTTP headers middleware:

- `src/app.js` enables core security middleware:
  - `helmet()` for secure HTTP headers.
  - `cors()` with default configuration.
  - `cookie-parser` for reading signed-in cookies.
- `src/config/arcjet.js` sets up the Arcjet client with:
  - `shield` protection (in LIVE mode).
  - `detectBot` with allowed categories (e.g., search engines, link preview bots).
  - A default `slidingWindow` rule enforcing request rate limits.
- `src/middleware/security.middleware.js` is applied globally via `app.use(securityMiddleware)` and:
  - Derives a `role` from `req.user?.role || "guest"`.
  - Chooses rate limits per role (guest: 5/min, user: 10/min, admin: 20/min).
  - Uses `aj.withRule(slidingWindow(...))` to enforce per-role rate limits.
  - Blocks requests flagged as bots, shield violations, or rate-limit violations with 403 responses and structured log messages.

When adjusting security behavior, prefer editing `src/config/arcjet.js` for global Arcjet rules and `src/middleware/security.middleware.js` for per-role limits and response shapes.

### Logging and observability

- `src/config/logger.js` configures a Winston logger with:
  - JSON logs including timestamps and error stacks.
  - File transports for `logs/error.log` and `logs/combined.log`.
  - A console transport with colorized/simple output when `NODE_ENV !== 'production'`.
- `morgan` is wired in `src/app.js` to send HTTP access logs into the Winston logger.
- Controllers and services log key lifecycle events (user creation/auth, errors, etc.).

Docker compose mounts `./logs` into the container so log files persist on the host.

## Conventions and notes for agents

- Module resolution uses Node `imports` aliases defined in `package.json`:
  - `#config/*` → `./src/config/*`
  - `#controllers/*` → `./src/controllers/*`
  - `#middleware/*` → `./src/middleware/*`
  - `#models/*` → `./src/models/*`
  - `#routes/*` → `./src/routes/*`
  - `#services/*` → `./src/services/*`
  - `#utils/*` → `./src/utils/*`
  - `#validations/*` → `./src/validations/*`

When adding new modules under these folders, prefer using the aliases for imports.

- Environment management:
  - `dotenv/config` is used in `src/index.js` and `src/config/database.js`, so most env vars can be read directly from `process.env`.
  - Docker compose files expect `.env.development` and `.env.production` in the project root. Keep any new required variables consistent between those files.

- When modifying auth flows:
  - Keep validation in `auth.validation.js`, HTTP behavior in `auth.controller.js`, and database/auth logic in `auth.service.js`.
  - Reuse the `jwttoken` and `cookies` utilities rather than duplicating JWT or cookie logic.
