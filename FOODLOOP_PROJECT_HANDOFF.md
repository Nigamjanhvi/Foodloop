# FoodLoop — Project Implementation and Operations Guide

**Project:** FoodLoop community surplus food rescue platform  
**Snapshot date:** 21 November 2026  
**Repository type:** TypeScript monorepo with React frontend, Express API, PostgreSQL database, and an optional independent email worker.

This document describes the implementation present in this repository. It does not claim that unimplemented DevOps, cloud, or production deployment work is complete. Do not put real secrets in this document or in `.env.example`.

## 1. Project purpose

FoodLoop connects local food donors with verified recipient organizations (NGOs) and volunteers who can help collect and deliver reserved food. The application supports registration and role-specific access, donation listings, reservations, volunteer assignment, pickup and delivery OTP verification, notifications, live page updates, and administrator oversight and analytics.

Food safety information in a listing is supplied by the donor. FoodLoop records those details; it does not independently certify food safety.

## 2. Technology and repository layout

| Area | Implementation |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router, Axios, Lucide icons, Recharts |
| API | Node.js, TypeScript, Express 5 |
| Persistence | PostgreSQL 16, SQL migrations, `pg` connection pool |
| Authentication | bcrypt password hashes, signed JWT bearer tokens, role middleware |
| Validation | Zod request schemas on the API; frontend form validation and API errors |
| Email | Nodemailer in a separate worker process |
| Live updates | Authenticated Server-Sent Events (SSE), backed by PostgreSQL event records |
| Local orchestration | Docker Compose for frontend, backend, worker, and PostgreSQL; npm workspaces |

```text
Foodloop/
├── backend/
│   ├── Dockerfile            # Multi-stage backend and worker image
│   ├── src/auth/             # Registration, login, JWT middleware, validation
│   ├── src/donations/        # Donations, discovery, reservations, admin listing APIs
│   ├── src/assignments/      # Volunteer profiles, assignments, OTP workflows
│   ├── src/notifications/    # Notification APIs, SSE hub, email worker
│   ├── src/db/               # PostgreSQL pool, migration and admin seed scripts
│   └── test/                 # PostgreSQL-backed API and workflow tests
├── frontend/src/
│   ├── auth/                 # Auth context, login, registration, protected routes
│   ├── dashboard/            # Role dashboards, admin pages, analytics
│   ├── donations/            # Donor and recipient donation/reservation screens
│   ├── assignments/          # Volunteer task and OTP screens
│   ├── notifications/        # User notification center and admin queue monitor
│   └── realtime/             # Authenticated SSE client and event hooks
├── frontend/Dockerfile       # Multi-stage React build and Vite preview server
├── database/migrations/      # Ordered additive SQL migrations 001–008
├── docker-compose.yml        # Four local services and persistent PostgreSQL volume
├── .dockerignore             # Excludes secrets, dependencies, and generated files
├── .env.example              # Safe configuration template; no live credentials
└── FOODLOOP_PROJECT_HANDOFF.md
```

## 3. Implementation by phase

### Phase 1 — Application foundation

- React/Vite frontend and Express API are separate npm workspaces in the same repository.
- PostgreSQL schema and migration runner are in place.
- `/api/health` reports API health and whether its configured database is reachable.
- Docker Compose defines a PostgreSQL 16 Alpine container with a persistent `foodloop_pgdata` volume.
- Vite proxies `/api` requests to the API at port 4000 during local development.

### Phase 2 — Authentication, roles, and organizations

- Public account roles are donor, NGO (`ngo` in the database/API), and volunteer. Admin is provisioned separately; public registration cannot create an admin.
- Registration validates names, email, password, phone, role-specific organization details, or volunteer service location.
- Passwords are bcrypt hashes and are never stored as plaintext.
- Login uses email and password. Phone is required when registering; legacy users can enroll a phone through the protected-by-password enrollment flow. Login does not ask for phone.
- JWTs are returned by the API and stored in browser `sessionStorage`; Axios attaches them as bearer tokens. JWT secrets stay on the backend.
- Authentication middleware validates tokens and checks the current account; authorization middleware checks roles.
- Donor and NGO organizations begin as pending. An administrator verifies or rejects an organization and can record a review note. Admin records the reviewer and verification timestamp.
- Admin bootstrap values are read from `.env` by `npm.cmd run db:seed-admin`. Existing non-admin accounts are never silently promoted.

### Phase 3 — Donations and reservations

- Verified donors can create, edit, list, view, and cancel food donation listings.
- Listings include food name/category, description, quantity/unit, preparation time, storage type and handling notes, pickup address, city/locality/pincode, and collection deadline.
- Categories: cooked meals, rice/grains, fruits, vegetables, bakery, packaged food, other.
- Units: meals, packets, kilograms, litres, boxes, other.
- Storage types: ambient, refrigerated, frozen, hot, other.
- The API validates quantities and time windows. A collection deadline must be future-dated and after preparation time.
- Verified recipient organizations discover local available listings using saved organization/service-area locality information and filters.
- NGOs can reserve quantities and provide an optional message. Donors accept or reject requests; NGOs can cancel. Database transactions and row locks protect inventory from oversubscription.
- Expired listings are handled by the existing API workflow. Admin can inspect donation and reservation records.

### Phase 4 — Volunteer assignment and delivery verification

- Volunteers have a saved city, locality, pincode, and availability. They can update those fields and browse eligible open tasks, accept/reject offers, and view active, completed, and historical tasks.
- An NGO may request volunteer assistance for an accepted reservation, subject to its state and pickup deadline. Eligible volunteers are matched against service location/availability.
- Assignment state and verification timestamps are persisted. Donors and recipients can inspect assignment state with role-aware contact visibility.
- Pickup and delivery verification use six-digit, expiring OTPs, HMAC-protected stored hashes, attempt limits, and role/ownership checks.
- Development-only code-display endpoints are blocked in production. Production issue endpoints queue encrypted OTP email and do not return the OTP plaintext.
- Donation delivered quantities are reconciled from delivered reservation history by migration 006.

### Phase 5 — Notifications, live updates, and impact analytics

- Database triggers write in-app notifications, scoped user events, and email jobs in the same transaction as the business change. Rolled-back actions do not leave notification records behind.
- A separate Nodemailer worker claims queue records with `FOR UPDATE SKIP LOCKED`, records status/attempts/errors, retries with bounded exponential backoff, and recovers abandoned processing claims.
- OTP email payloads use AES-256-GCM encryption at rest in the queue. The OTP verification hash remains separately protected. Queue monitor responses exclude email bodies and OTP material.
- Authenticated SSE streams send only the signed-in user’s events and support reconnect replay using `Last-Event-ID`. Browser code sends JWT in an Authorization header, not in the URL. Frontend pages refetch authoritative REST data when relevant events arrive.
- Role dashboards show a live connection state and notification unread count. Donor, NGO, volunteer, and admin activity pages have notification views. Admin has queue/worker monitoring and actual database-backed analytics.
- Analytics keep food quantities grouped by their unit and distinguish delivered quantity from merely offered or reserved quantities. They are computed from PostgreSQL records rather than fabricated monitoring status.

### Phase 6 — Docker and Docker Compose

- `frontend/Dockerfile` builds the existing React/Vite frontend and runs its production build with Vite Preview. The Preview proxy forwards `/api` requests, including authenticated SSE, to the backend container.
- `backend/Dockerfile` builds the existing Express TypeScript API and copies the compiled application, the TypeScript worker entrypoint used by the existing npm worker script, and SQL migration files into a Node Alpine runtime image. The same image runs the independent email worker.
- Root `docker-compose.yml` contains four services: `frontend`, `backend`, `worker`, and `postgres` (PostgreSQL 16 Alpine).
- Compose frontend/backend/worker containers share the existing environment values. The host `DATABASE_URL` can remain `localhost:5434`; Compose constructs a container-only database URL using `postgres:5432` and the same `POSTGRES_*` variables as the database service.
- PostgreSQL retains the existing `foodloop_pgdata` named volume and `pg_isready` health check. No migration scripts are mounted into `docker-entrypoint-initdb.d`.
- Backend waits for the database, runs `node backend/dist/db/migrate.js`, then starts the API. The existing `schema_migrations` runner applies only unrecorded migrations; PostgreSQL initialization no longer independently applies the SQL files.
- Backend health calls `/api/health`; frontend health fetches `/`; worker health queries the latest persisted worker heartbeat and status. The worker is not considered healthy solely because its process/container is running.
- All app containers use restart policies and run as the unprivileged Node user where practical. `.dockerignore` prevents `.env`, credentials, dependency trees, build output, and local state from entering image build context.
- Docker Compose is for local/academic operation. It is not an AWS deployment or a production hosting claim.

## 4. Roles and application workflows

### Donor

1. Register with a contact phone and donor organization details.
2. Wait for administrator verification before using verified-donor tools.
3. Create a donation with valid preparation, storage, quantity, pickup location, and deadline details.
4. Review incoming NGO reservation requests; accept or reject them.
5. If volunteer help is needed, follow the assignment workflow when the reservation is accepted.
6. Issue a pickup OTP through the authorized flow; the volunteer verifies it at collection.
7. Follow the delivery flow and receive completion updates.

### NGO / recipient

1. Register with recipient organization details and optional service areas.
2. Wait for admin verification.
3. Browse eligible local donations and submit a quantity request/message.
4. Track pending/accepted/rejected/cancelled/picked-up/delivered reservation status.
5. After the donor accepts, request volunteer assistance if needed.
6. Issue a delivery OTP when appropriate; the assigned volunteer verifies it at handoff.

### Volunteer

1. Register with a service location.
2. Set profile locality and availability.
3. Review eligible open tasks and accept or decline an offer.
4. Verify pickup and delivery using the OTPs supplied through the configured flow.
5. Review active, completed, and historical tasks.

### Admin

1. Create or seed the administrator account using environment configuration.
2. Review and verify/reject organizations with an optional note.
3. Inspect accounts, donations, reservations, and operational pages.
4. Review platform analytics and the actual notification queue/worker records.

## 5. Frontend routes

All role dashboards require a valid login and enforce the matching role. `/dashboard` redirects the user to the route for their stored role.

| Path | Role | Screen/workflow |
|---|---|---|
| `/` | Public | Landing page |
| `/login` | Public | Email/password login |
| `/register` | Public | Donor, NGO, or volunteer registration |
| `/dashboard/donor` | Donor | Donor overview |
| `/dashboard/donor/donations` | Donor | Donation listings |
| `/dashboard/donor/donations/new` | Donor | Create donation |
| `/dashboard/donor/donations/:id` | Donor | Donation detail and management |
| `/dashboard/donor/reservations` | Donor | Incoming reservation requests |
| `/dashboard/donor/reservations/:id` | Donor | Reservation, assignment, and pickup/delivery status |
| `/dashboard/donor/history` | Donor | Donation history |
| `/dashboard/donor/notifications` | Donor | Notifications |
| `/dashboard/ngo` | NGO | Recipient overview |
| `/dashboard/ngo/available` | NGO | Browse eligible food |
| `/dashboard/ngo/available/:id` | NGO | Donation detail and request flow |
| `/dashboard/ngo/reservations` | NGO | Reservations and history |
| `/dashboard/ngo/reservations/:id` | NGO | Reservation and volunteer assistance |
| `/dashboard/ngo/notifications` | NGO | Notifications |
| `/dashboard/volunteer` | Volunteer | Volunteer overview |
| `/dashboard/volunteer/profile` | Volunteer | Location and availability |
| `/dashboard/volunteer/available` | Volunteer | Available assignments |
| `/dashboard/volunteer/tasks` | Volunteer | Active assignments |
| `/dashboard/volunteer/tasks/:id` | Volunteer | Assignment detail and OTP verification |
| `/dashboard/volunteer/completed` | Volunteer | Completed work |
| `/dashboard/volunteer/history` | Volunteer | Task history |
| `/dashboard/volunteer/notifications` | Volunteer | Notifications |
| `/dashboard/admin` | Admin | Admin overview |
| `/dashboard/admin/organizations` | Admin | Organization review queue |
| `/dashboard/admin/users` (also role filters) | Admin | User management/listing |
| `/dashboard/admin/donations` | Admin | Donation inspection |
| `/dashboard/admin/reservations` | Admin | Reservation inspection |
| `/dashboard/admin/activity` | Admin | Admin-scoped notifications/activity |
| `/dashboard/admin/notifications` | Admin | Email queue/worker monitoring |
| `/dashboard/admin/analytics` | Admin | Impact analytics |
| `/dashboard/admin/trust` | Admin | Access/trust page |
| `/dashboard/admin/tasks`, `/devops`, `/settings` | Admin | Explicit placeholders; these full workflows are not implemented |

Unknown routes display a 404 page. Placeholder pages explicitly say that planned information is not fabricated.

## 6. Backend API reference

API base path is `/api/v1` unless shown otherwise. Successful API responses use `{ "data": ... }`; error responses use `{ "error": { "code", "message", ... } }`. Protected routes require `Authorization: Bearer <JWT>`.

### Health and identity

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | API and PostgreSQL health check |
| GET | `/api/v1` | Public | API identity/version |
| POST | `/api/v1/auth/register` | Public, rate-limited | Register donor/NGO/volunteer |
| POST | `/api/v1/auth/login` | Public, rate-limited | Email/password login |
| POST | `/api/v1/auth/enroll-phone` | Public, rate-limited; requires current password | Add phone to legacy account |
| GET | `/api/v1/auth/me` | Authenticated | Return authenticated identity |
| POST | `/api/v1/organizations` | Donor/NGO | Add an organization |
| GET | `/api/v1/organizations/me` | Donor/NGO | Current user’s organization/service areas |

Registration password policy is at least 12 characters, including uppercase, lowercase, and a number. Login accepts at least 6 characters for legacy compatibility. Public registration does not accept the admin role.

### Administration

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/admin/overview` | Admin | Counts and recent users/reviews |
| GET | `/api/v1/admin/users` | Admin | Paginated/searchable user list |
| GET | `/api/v1/admin/organizations` | Admin | Paginated organization review list and filters |
| PATCH | `/api/v1/admin/organizations/:id/verification` | Admin | Verify/reject and record review metadata |
| GET | `/api/v1/admin/donations` | Admin | Inspect/filter donation records |
| GET | `/api/v1/admin/reservations` | Admin | Inspect/filter reservation records |

### Donations and reservations

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/donations` | Verified donor | Publish donation |
| GET | `/api/v1/donations/mine` | Donor | List own donations |
| GET | `/api/v1/donations/available` | NGO | Browse eligible local donations |
| GET | `/api/v1/donations/:id` | Donor/NGO/Admin | Authorized donation detail |
| PATCH | `/api/v1/donations/:id` | Owner donor | Edit a listing |
| POST | `/api/v1/donations/:id/cancel` | Owner donor | Cancel a listing |
| POST | `/api/v1/donations/:id/reservations` | Verified NGO | Request a quantity |
| GET | `/api/v1/reservations/mine` | NGO | List own reservations |
| GET | `/api/v1/reservations/received` | Donor | List requests received by donor |
| GET | `/api/v1/reservations/:id` | Authorized party | Reservation detail |
| PATCH | `/api/v1/reservations/:id/accept` | Donor | Accept request |
| PATCH | `/api/v1/reservations/:id/reject` | Donor | Reject request |
| POST | `/api/v1/reservations/:id/cancel` | NGO | Cancel own reservation |

List routes accept pagination and relevant filters such as status, search, category, and location. Request schemas enforce bounded page sizes and field values.

### Volunteers, assignments, and OTPs

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/volunteers/me` | Volunteer | View profile |
| PATCH | `/api/v1/volunteers/me` | Volunteer | Update location/availability |
| POST | `/api/v1/reservations/:id/assignments` | NGO | Request assistance on accepted reservation |
| GET | `/api/v1/reservations/:id/assignments` | Donor/NGO party | View assignment state |
| GET | `/api/v1/volunteers/assignments/available` | Volunteer | Browse eligible offers |
| GET | `/api/v1/volunteers/assignments/mine` | Volunteer | View assignments/history |
| GET | `/api/v1/assignments/:id` | Authorized party | Assignment details |
| POST | `/api/v1/assignments/:id/accept` | Eligible volunteer | Accept offer |
| POST | `/api/v1/assignments/:id/reject` | Eligible volunteer | Decline offer |
| POST | `/api/v1/assignments/:id/cancel` | Authorized workflow party | Cancel assignment |
| POST | `/api/v1/assignments/:id/pickup-otp/dev-code` | Donor; development only | Retrieve development code |
| POST | `/api/v1/assignments/:id/delivery-otp/dev-code` | NGO; development only | Retrieve development code |
| POST | `/api/v1/assignments/:id/pickup-otp/issue` | Donor | Queue pickup OTP email |
| POST | `/api/v1/assignments/:id/delivery-otp/issue` | NGO | Queue delivery OTP email |
| POST | `/api/v1/assignments/:id/pickup-otp/verify` | Assigned volunteer | Verify pickup code |
| POST | `/api/v1/assignments/:id/delivery-otp/verify` | Assigned volunteer | Verify delivery code |

OTP issue/verification endpoints are rate-limited. Codes expire after the configured workflow expiry and have bounded verification attempts. Production email depends on both SMTP and the encryption key being configured.

### Notifications, SSE, analytics, and monitoring

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/notifications` | Authenticated user | Paginated own notification history; `unread=true/false` filter |
| GET | `/api/v1/notifications/unread-count` | Authenticated user | Own unread count |
| PATCH | `/api/v1/notifications/:id/read` | Owner only | Mark one notice read |
| PATCH | `/api/v1/notifications/read-all` | Authenticated user | Mark own notices read |
| GET | `/api/v1/events/stream` | Authenticated user | User-scoped SSE with optional `Last-Event-ID` header |
| GET | `/api/v1/analytics/overview` | Admin | Platform impact/operations summary |
| GET | `/api/v1/analytics/donations/monthly` | Admin | Recent monthly donations and unit-grouped quantities |
| GET | `/api/v1/analytics/donations/locality` | Admin | Donation totals by locality and unit |
| GET | `/api/v1/analytics/reservations` | Admin | Reservation counts by status |
| GET | `/api/v1/analytics/delivery` | Admin | OTP-verified pickup/delivery completion rates |
| GET | `/api/v1/admin/notifications/stats` | Admin | Queue counts, worker heartbeat, recent event aggregates |
| GET | `/api/v1/admin/notifications` | Admin | Paginated/filterable queue records; no body or OTP exposure |

## 7. Database schema and migrations

The migration runner processes numbered SQL files in order and records them in `schema_migrations`. Each unapplied migration runs in a transaction. Existing migration files should be treated as immutable after they have been applied; introduce a higher numbered migration for later changes.

| Migration | Purpose |
|---|---|
| `001_initial.sql` | Core users, organizations, service areas, donations, reservations, volunteer profiles, assignments, notification queue, indexes |
| `002_organization_verification.sql` | Reviewer, review timestamp, and note fields on organizations |
| `003_required_phone_identity.sql` | E.164 phone identity and unique indexes while retaining legacy phone compatibility |
| `004_donation_reservations_workflow.sql` | Donation storage/location workflow fields, quantity accounting, expanded statuses/categories/units, reservation metadata and indexes |
| `005_volunteer_assignment_verification.sql` | Volunteer profile metadata, assignment states/OTP attempts and expiries, assignment rejection records, delivered quantity field |
| `006_backfill_verified_deliveries.sql` | Reconciles legacy verified deliveries and backfills delivered quantities |
| `007_notifications_events_worker.sql` | Extends email queue; creates in-app notifications, durable user events, worker state; adds business notification triggers |
| `008_admin_business_events.sql` | Adds administrator business activity, assignment-decline events, and worker operational events |

Core tables:

| Table | Contents and key relationships |
|---|---|
| `users` | UUID, unique email, bcrypt hash, role, full name, legacy and E.164 phone, active flag, timestamps |
| `organizations` | Owner user, donor/recipient type, verification state, address/locality/pincode, reviewer, note, verification timestamp |
| `service_areas` | Organization’s additional city/locality/pincode matching areas |
| `donations` | Donor organization, food/category, total/reserved/remaining/delivered quantity, unit, preparation/storage, pickup location, deadline, status |
| `reservations` | Donation, recipient organization, quantity, status, optional message/reason, timestamps |
| `volunteer_profiles` | Volunteer’s city/locality/pincode and availability |
| `reservation_assignments` | Reservation, assigned volunteer, state, offer/accept timestamps, hashed OTP values/expiry/attempt counts, verification timestamps |
| `assignment_rejections` | Volunteer-specific rejection history for an assignment |
| `notification_queue` | Recipient email, subject/body, event type, status/attempts/retry timestamps, optional encrypted payload, idempotency key |
| `in_app_notifications` | Recipient, event type, safe title/message/metadata, resource pointer, read timestamp, idempotency key |
| `user_events` | Durable recipient-scoped event stream and replay IDs for SSE |
| `notification_worker_state` | Worker start/heartbeat/stop timestamps, last error and completed job count |
| `schema_migrations` | Migration filename and applied timestamp |

Important status families include organization `pending/verified/rejected`; donation `available/partially_reserved/fully_reserved/expired/cancelled` plus retained legacy workflow values; reservation `pending/accepted/rejected/cancelled/expired/picked_up/delivered` plus compatibility values; assignment `pending/offered/accepted/rejected/cancelled/picked_up/delivered`; notification job `pending/processing/sent/failed`.

## 8. Security, privacy, and reliability

- Secrets belong in the ignored local `.env` or a secrets manager, never in frontend source, documentation, or committed environment examples.
- JWT validation, current active-user checks, and role checks are server-side. Organization and resource ownership are checked in API workflows.
- Passwords use bcrypt; OTP values are not stored plaintext in their verification columns.
- Production OTP email payloads are authenticated-encrypted with AES-256-GCM. The worker clears protected payload/body after successful delivery or exhausted/expired jobs.
- Notification history and SSE events are scoped to the authenticated user. Admin operational endpoints require admin role.
- Inputs have Zod validation, auth/OTP/SSE endpoints have rate limits, Express uses Helmet, JSON request size is bounded, and SQL values are parameterized.
- Business side effects use transactions. Quantity/assignment concurrency is guarded by database locking and uniqueness constraints.
- Email sending is at least once. If SMTP accepts a message and the worker crashes before recording success, a retry may send a duplicate; a stable Message-ID helps identify retries but cannot guarantee exactly once delivery.
- SMTP is optional for the API and in-app notifications. Without valid SMTP, the worker reports an error/offline state and queued jobs remain in PostgreSQL.

## 9. Docker Compose local stack on Windows PowerShell

Requirements: Docker Desktop with its Linux container engine running. From the repository root, copy `.env.example` to `.env` if needed, set a random `JWT_SECRET` of at least 32 bytes, and make sure `POSTGRES_PASSWORD` matches the password in the host `DATABASE_URL`. The Compose backend/worker URL is built from `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`, but uses the internal host name `postgres` and port 5432.

Build and start all four services:

```powershell
docker compose build
docker compose up -d
docker compose ps
```

Follow all service logs or just worker logs:

```powershell
docker compose logs -f
docker compose logs -f worker
```

The frontend defaults to `http://localhost:5173`, and the backend health endpoint defaults to `http://localhost:4000/api/health`. If the frontend host port is occupied, set `FOODLOOP_FRONTEND_HOST_PORT` in `.env` and keep browser origin/CORS configuration aligned. The Vite Preview proxy uses `API_PROXY_TARGET=http://backend:4000` inside Docker; browser code never sees Docker hostnames or SMTP/JWT credentials.

PostgreSQL keeps the existing `foodloop_pgdata` named volume. The backend runs the existing ordered migration runner after PostgreSQL is healthy and before Express starts. The SQL folder is not mounted into PostgreSQL's init directory, so migrations have one source of truth (`schema_migrations`) and are not independently applied by both PostgreSQL initialization and the application. To run only PostgreSQL for host development, `docker compose up -d postgres` remains supported; then use `npm.cmd run db:migrate` from the root.

Health checks require PostgreSQL readiness, a successful backend `/api/health`, a successful frontend HTTP response, and a recent live worker heartbeat in PostgreSQL with no stop/error state. SMTP must be configured for the worker to become healthy and send email. `ADMIN_NOTIFICATION_EMAIL` is passed through as requested, but current admin event delivery is database-backed to admin users and does not consume that optional address.

Stop services without deleting database data:

```powershell
docker compose down
```

Never use `docker compose down -v` for routine shutdown because it deletes the named PostgreSQL data volume.

### INT333 Docker viva notes

- **Image:** a built package containing the application and runtime dependencies; a container is a running instance of that image.
- **Dockerfile:** the repeatable recipe for each app image. Multi-stage builds separate TypeScript/frontend build tools from the runtime filesystem where practical.
- **Compose service:** a named container with environment, health, ports, restart behavior, and dependencies. Compose DNS lets services connect by service name (`postgres`, `backend`) instead of host loopback.
- **Port mapping:** `host:container`. PostgreSQL is `5434:5432` for Windows host tools while containers use `postgres:5432`. Frontend defaults to `5173:5173`; API defaults to `4000:4000`.
- **Health check:** an executable condition for readiness/operation, not just a process existence check. `depends_on: condition: service_healthy` starts app dependencies in order.
- **Volume:** `foodloop_pgdata` stores PostgreSQL data outside the disposable container layer, so `docker compose down` does not delete records.
- **Environment variables:** Compose passes database, JWT, and optional email settings at runtime; `.dockerignore` excludes `.env` so credentials are not copied into image layers.
- **Migration flow:** backend starts after PostgreSQL is healthy and uses `schema_migrations` to run each unapplied migration once. No duplicate PostgreSQL init-script path is configured.

### Evidence status

Phase 6 was run locally with Docker Desktop. `docker compose config --quiet` and the frontend/backend image builds completed successfully. All four containers reached healthy status: PostgreSQL, backend, frontend, and notification worker. Existing local processes were already using ports 4000 and 5173, so this run used `FOODLOOP_API_HOST_PORT=4001` and `FOODLOOP_FRONTEND_HOST_PORT=5175`; PostgreSQL used host port 5434. Checks returned HTTP 200 for the frontend at `http://localhost:5175/`, the API health route at `http://localhost:4001/api/health`, and the proxied health route at `http://localhost:5175/api/health`. The API reported its database connection as healthy and logged that migrations were current.

Persistence was checked by recording read-only row counts for users, organizations, donations, reservations, and `schema_migrations`, restarting only PostgreSQL, then checking the counts again. They remained 6, 4, 3, 2, and 8, respectively; the services recovered healthy afterward. `npm.cmd test` passed all 12 backend tests, and `npm.cmd run build` completed both frontend and backend builds. These checks establish container startup, HTTP health, migration state, and volume persistence. They do not establish a full manual browser workflow or prove that a real email reached an inbox; no test email was sent and no screenshot asset was captured. Capture your own screenshots of the running application/Compose output for a presentation, and redact personal data and secrets.

## 10. Local development without app containers on Windows PowerShell

Requirements: Node.js/npm and Docker Desktop (Linux container engine) for local PostgreSQL.

1. Copy `.env.example` to `.env` if needed. Set a random `JWT_SECRET` with at least 32 bytes. Check that `DATABASE_URL` port matches `FOODLOOP_DB_HOST_PORT`.
2. Start Docker Desktop and wait for its engine to be ready.
3. From the repository root, start the database:

   ```powershell
   docker compose up -d postgres
   ```

4. Install packages:

   ```powershell
   npm.cmd install
   ```

5. Apply any migrations not yet applied:

   ```powershell
   npm.cmd run db:migrate
   ```

6. Optionally create the local admin account after setting unique local `ADMIN_*` values in `.env`:

   ```powershell
   npm.cmd run db:seed-admin
   ```

7. Start the API and frontend together:

   ```powershell
   npm.cmd run dev
   ```

   The backend listens on `http://localhost:4000`. Vite is configured to prefer `http://localhost:5173`; if that port is occupied, Vite automatically selects the next available port (for example 5174) and prints the exact URL. Open the URL printed in that terminal. Keep the terminal open while using the site. Press Ctrl+C to stop both processes.

8. Check API/database connectivity at `http://localhost:4000/api/health`.

For the current example configuration, `.env.example` and Compose default to database host port 5434; the container always listens on 5432. The app’s `DATABASE_URL` and Compose host port must agree. If ports 4000 or 5173 are already occupied, set `FOODLOOP_API_HOST_PORT` or `FOODLOOP_FRONTEND_HOST_PORT` to unused host ports (for example, 4001 and 5175). The named database volume persists data; do not remove it to troubleshoot a connection problem.

### SMTP worker setup

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in the untracked `.env`. Set `NOTIFICATION_ENCRYPTION_KEY` to base64 encoding of 32 random bytes. Generate a local key with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Run the worker in a second terminal from the project root:

```powershell
npm.cmd run notifications:worker
```

Do not use the placeholder key or `.invalid` sender for actual delivery. Do not paste SMTP credentials or keys into source files/issues/screenshots.

## 11. Build and test commands

```powershell
npm.cmd run build     # Frontend TypeScript/Vite production build, then backend TypeScript build
npm.cmd test          # PostgreSQL-backed auth, donation, assignment, dashboard, and Phase 5 tests
```

Tests create isolated randomly named PostgreSQL schemas, apply the repository migrations to those schemas, and remove only those test schemas. They require `TEST_DATABASE_URL` or `DATABASE_URL` to point to a reachable PostgreSQL instance. Current verification snapshot: 12 backend tests passed; frontend and backend builds passed. Vite emits a large JavaScript chunk warning and React Router package directive warnings; they do not fail the build.

Expected rollback tests deliberately trigger PostgreSQL check-constraint errors to verify atomic rollback. Those log lines may look alarming, but are expected when their corresponding test passes.

## 12. Current limitations and explicitly unimplemented work

- There is no AWS deployment, Terraform infrastructure, Kubernetes/EKS setup, CI/CD pipeline, production hosting, or paid cloud resource configured by this application work.
- There is no Puppet configuration. Ansible/GitHub Actions/Nagios infrastructure and workflows are not part of the implemented user-facing Phase 5 work; verify repository files before claiming them as available.
- Admin DevOps, task management, and platform settings screens are placeholders, not connected production controls.
- Real SMTP inbox delivery was not verified during the Phase 6 container smoke check; the worker did start and pass its health check using the configured worker/database state.
- No fake organization verification, monitoring state, demo user, or production deployment status is generated. Organization status, worker status, queue status, and analytics are drawn from persisted records.
- A browser tab may need to reload after authentication changes made in a different tab; SSE synchronizes persisted business events, not browser sessionStorage credentials.
- The Phase 6 images and Compose stack were built and run locally; host port overrides may be needed if the default frontend/API ports are occupied. A complete role-by-role browser workflow remains for manual exploration.
- Local behavior depends on PostgreSQL being available and `.env` values matching Compose configuration.

## 13. Useful source files

- [Application routes](frontend/src/App.tsx)
- [Backend application and API registration](backend/src/app.ts)
- [Authentication validation and registration policy](backend/src/auth/schemas.ts)
- [Donation and reservation APIs](backend/src/donations/routes.ts)
- [Volunteer and OTP APIs](backend/src/assignments/routes.ts)
- [Notification, SSE, analytics, and monitoring APIs](backend/src/notifications/routes.ts)
- [Email worker process](backend/src/notifications/worker.ts)
- [Email queue processing/retry logic](backend/src/notifications/workerCore.ts)
- [Realtime frontend hook](frontend/src/realtime/useFoodLoopRealtime.ts)
- [Docker Compose database service](docker-compose.yml)
- [Backend and worker Docker image](backend/Dockerfile)
- [Frontend Docker image](frontend/Dockerfile)
- [Docker build context exclusions](.dockerignore)
- [Safe environment template](.env.example)
- [Database migrations](database/migrations/)

