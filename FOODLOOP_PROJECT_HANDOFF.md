# FoodLoop — Project Implementation and Operations Guide

**Project:** FoodLoop community surplus food rescue platform  
**Snapshot date:** 24 November 2026

**Repository type:** TypeScript monorepo with React frontend, Express API, PostgreSQL database, and an optional independent email worker.

This document describes the implementation present in this repository. It does not claim that unimplemented DevOps, cloud, or production deployment work is complete. Do not put real secrets in this document or in `.env.example`.

## 1. Project purpose

FoodLoop connects local food donors with verified recipient organizations (NGOs) and volunteers who can help collect and deliver reserved food. The application supports registration and role-specific access, donation listings, reservations, volunteer assignment, pickup and delivery OTP verification, notifications, live page updates, and administrator oversight and analytics.

Food safety information in a listing is supplied by the donor. FoodLoop records those details; it does not independently certify food safety.

## 2. Technology and repository layout

| Area                | Implementation                                                               |
| ------------------- | ---------------------------------------------------------------------------- |
| Frontend            | React 19, TypeScript, Vite, React Router, Axios, Lucide icons, Recharts      |
| API                 | Node.js, TypeScript, Express 5                                               |
| Persistence         | PostgreSQL 16, SQL migrations, `pg` connection pool                          |
| Authentication      | bcrypt password hashes, signed JWT bearer tokens, role middleware            |
| Validation          | Zod request schemas on the API; frontend form validation and API errors      |
| Email               | Nodemailer in a separate worker process                                      |
| Live updates        | Authenticated Server-Sent Events (SSE), backed by PostgreSQL event records   |
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
├── frontend/Dockerfile       # Multi-stage local Compose build with Vite preview
├── frontend/Dockerfile.prod  # Production static frontend build with Nginx
├── database/migrations/      # Ordered additive SQL migrations 001–008
├── docker-compose.yml        # Four local services and persistent PostgreSQL volume
├── infra/deploy/             # Phase 9 production Compose, proxy config, and runbook
├── .dockerignore             # Excludes secrets, dependencies, and generated files
├── .env.example              # Safe configuration template; no live credentials
├── infra/terraform/           # Phase 7 AWS network, IAM, ECR, EC2 infrastructure
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

### Phase status

Phases 1–6 (application foundation, authentication, food donation and reservations, volunteer pickup/delivery verification, notifications and impact analytics, and local Docker Compose) are completed. Phase 7 (Terraform infrastructure) and Phase 8 (Ansible host configuration) are completed as described below. Phase 9 is partially deployed: the user reports that the frontend donor dashboard was opened through EC2 over temporary HTTP. Full production verification and hardening remain pending. Phases 10–12 remain pending.

### Phase 7 — Terraform AWS infrastructure

- `infra/terraform/` describes one VPC, a public subnet and route, Internet Gateway, SSH-restricted security group, EC2 IAM role/profile, two encrypted immutable ECR repositories, and one Amazon Linux 2023 EC2 instance with an encrypted gp3 root disk and IMDSv2 required.
- Terraform uses the shared AWS CLI profile `foodloop-terraform`; no credentials or key material are stored in Terraform configuration. The instance role is limited to image pulls from the FoodLoop frontend/backend ECR repositories.
- `terraform.tfvars.example` has safe defaults and a documentation-only `/32` administrator CIDR placeholder. The real local `terraform.tfvars`, state, plan files, and `.terraform` directory are ignored; `.terraform.lock.hcl` remains eligible for version control.
- Terraform uses local state for this learning deployment. The existing local Docker Compose files and application code were not modified for Phase 7.
- `terraform fmt -recursive`, `terraform init`, and `terraform validate` completed successfully; `.terraform.lock.hcl` locks AWS provider v6.73.0. The user confirms Phase 7 infrastructure provisioning is complete, including the SSH rule update. This documentation update did not run `terraform apply`/`destroy` or independently refresh AWS state; do not treat this note as a current drift check.

### Phase 8 — Ansible server configuration (completed)

- `infra/ansible/` contains project configuration, an example inventory, reusable common and Docker roles, `site.yml`, `verify.yml`, a daemon JSON template, and operator documentation.
- The common role asserts Amazon Linux 2023 x86_64 and installs required host utilities with DNF; full package upgrades are configurable and disabled by default.
- The Docker role installs the Amazon Linux `docker` package, enables the service, configures bounded JSON log rotation, adds `ec2-user` to the Docker group, installs pinned Compose V2 after official checksum verification, and creates restrictive `/opt/foodloop` directories.
- Inventory uses the user-supplied host address and resolves the SSH key from `FOODLOOP_SSH_KEY` or `$HOME/.ssh/foodloop-key.pem`. Local inventory, retry output, and `.vault_pass` are ignored.
- The user confirms the Ansible configuration and verification steps completed successfully. Docker daemon access was resolved by opening a fresh SSH session after adding the deployment user to the Docker group. No task counts, terminal output, or timestamps are asserted here because they were not supplied.
- Local syntax checks for both playbooks and the inventory graph also passed from the WSL virtual environment. On the Windows-mounted WSL filesystem, validation explicitly selected `ANSIBLE_CONFIG` because Ansible otherwise ignores a config discovered in a world-writable mount.
- Phase 8 configures the host only. It does not deploy FoodLoop containers, production secrets, or application data.

### Phase 9 — FoodLoop production deployment on EC2 (partially deployed; verification pending)

**Preparation and an initial temporary HTTP deployment are reported complete. Full production verification and hardening are pending.** The root local `docker-compose.yml`, `frontend/Dockerfile`, and `backend/Dockerfile` remain unchanged. Deployment facts below are based on the user's supplied progress; this documentation update did not connect to AWS or independently inspect the EC2 host.

Prepared files:

- `frontend/Dockerfile.prod` builds the frontend using the existing root npm workspace manifests and lockfile, then serves the generated static files using pinned `nginx:1.30.8-alpine3.24`.
- `infra/deploy/nginx.prod.conf` listens on internal port 8080, serves the SPA with `index.html` fallback, and proxies `/api/` to `backend:4000` without rewriting the request path; it preserves Authorization/forwarded-protocol headers and disables proxy buffering for authenticated SSE. The frontend health check fetches `/` on port 8080.
- `infra/deploy/compose.prod.yml` pins Compose project name `foodloop-prod`, uses the existing private ECR repositories `foodloop-frontend` and `foodloop-backend` with a required explicit immutable `IMAGE_TAG`, and uses the backend image for the worker because its runtime includes the worker script and dependencies.
- `infra/deploy/Caddyfile` terminates HTTPS for the configured DNS name and forwards to the Nginx frontend. Explicit persistent volumes are `foodloop_pgdata_prod`, `foodloop_caddy_data` mounted at `/data`, and `foodloop_caddy_config` mounted at `/config`.
- `infra/deploy/.env.production.example` contains placeholders only; real environment and bootstrap seed values remain outside source control.
- `infra/deploy/README.md` documents the `linux/amd64` builds, local `foodloop-admin` ECR push, EC2 instance-role pull, non-secret file transfer, direct on-EC2 environment creation, smoke checks, backup/restore, and rollback.
- `README.md` summarizes the partial deployment and remaining verification.
- `.gitignore` allows the safe `.env.production.example` while ignoring real `.env.production` values.

The production frontend uses same-origin `/api/v1`; Nginx is configured to proxy API and SSE traffic privately to Express. The repository Caddyfile is configured for HTTPS using `FOODLOOP_DOMAIN`, while the user reports that the temporary EC2 Caddy configuration used HTTP on port 80 and proxied to `frontend:8080`. These are distinct configurations: the temporary HTTP setup is not hardened public production. In the repository Compose configuration Caddy alone publishes TCP 80/443; PostgreSQL has no published port and persists to `foodloop_pgdata_prod` on an internal Docker network. Terraform already allows inbound TCP 80 and 443 while SSH remains restricted to `admin_cidr` in `infra/terraform/security.tf`. EC2's attached `foodloop-ec2-role` can obtain ECR auth and pull from the two repositories; local `foodloop-admin` needs push permissions. The current Ansible role does not install AWS CLI v2. The production environment file is reported created interactively on EC2 under `/opt/foodloop/config/` with restrictive permissions; its values are not recorded here. Rerunning Ansible can reset that directory's mode to `0750`; reapply private permissions before Compose use.

#### User-reported deployment milestones and evidence

- Existing host: `i-0998980f6f7059da3`, Amazon Linux 2023, `t3.small`, x86_64, `ap-south-1`. The user reports successful SSH access and verification of Docker Engine `25.0.14` and Docker Compose `v5.8.0`.
- The user reports that production frontend/backend images were built for the host architecture, pushed to the existing private ECR repositories, and checked with ECR image-describe commands. Release tag: `p9-20261124-222955`.
- Frontend: `247558788371.dkr.ecr.ap-south-1.amazonaws.com/foodloop-frontend:p9-20261124-222955`, digest `sha256:b1719f0887ee3c6dac87e54c10e33a0e56eab1399a39587622d38cec62209e25`.
- Backend (also intended for the worker): `247558788371.dkr.ecr.ap-south-1.amazonaws.com/foodloop-backend:p9-20261124-222955`, digest `sha256:90a0ef47dbcc6453bb07cb6ee3bcd132a37848b675e309c3b547efdf35e82b9e`.
- The user reports transferring the non-secret Compose and Caddy files to `/opt/foodloop`, creating the production environment file directly under `/opt/foodloop/config/` with restrictive permissions, and using the EC2 instance role for ECR authentication rather than copying workstation credentials.
- The user reports a browser visit to `http://13.200.252.1/dashboard/donor`: the React donor dashboard rendered, showed the donor organization's pending administrator-verification state, and displayed the UI's “Live” connection indicator. This is visual route-rendering evidence only; it does not prove API health, live SSE delivery, database connectivity or persistence, container health, or role workflows. The public IP can change after an instance stop/start.
- No evidence supplied confirms PostgreSQL persistence, backend health, migration state on EC2, any service health status, SMTP delivery, worker health, admin bootstrap, or full integration tests. These remain unverified or pending.

#### Remaining Phase 9 work

- [ ] Replace the temporary HTTP configuration with the repository's domain-based HTTPS Caddy configuration after configuring a real DNS name; confirm the current public address and DNS. Do not submit credentials over HTTP.
- [ ] Rotate JWT, database and notification-encryption secrets that were previously shared, using a planned secure procedure. Do not record values in documentation.
- [ ] Verify Compose service status, migrations, `GET /api/health` (which checks PostgreSQL), frontend-proxied API, database volume mount, and that PostgreSQL has no host port mapping.
- [ ] Configure and verify SMTP before expecting the notification worker to become healthy or deliver email; SMTP was postponed and worker/email delivery are unverified.
- [ ] Perform the existing one-time production admin bootstrap securely after migrations and backend health, then test admin sign-in. Do not repeat a successful seed.
- [ ] Verify donor, recipient, volunteer, and admin workflows and retain genuine, redacted evidence. The observed donor organization is still awaiting admin approval.
- [ ] Verify database backup/restore procedure and document actual results before treating the deployment as production-ready.

This documentation update did not build or push images, connect to EC2, run deployment commands, or independently validate AWS state. The supplied browser evidence shows the dashboard route rendered over HTTP; it does not establish a fully verified production deployment.

#### Phase 9 operating notes

- The reported deployed release is `p9-20261124-222955`; its exact image refs and digests are recorded above. For a future release, build with `docker buildx build --platform linux/amd64 --load -f frontend/Dockerfile.prod -t <registry>/foodloop-frontend:<unique-tag> .` and `docker buildx build --platform linux/amd64 --load -f backend/Dockerfile -t <registry>/foodloop-backend:<same-tag> .`, from repository root. Push explicit new tags to immutable ECR repositories; do not reuse a tag.
- On EC2, `aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin "$REGISTRY"` uses the attached `foodloop-ec2-role` instance profile. Do not copy local credentials. The Terraform role has ECR auth and pull permissions; local image push requires ECR upload/put-image permissions.
- Required runtime settings are `ECR_REGISTRY`/`IMAGE_TAG` (image selection), `FOODLOOP_DOMAIN`/`CORS_ORIGIN` (HTTPS host and browser origin), `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` (database), `JWT_SECRET`/`JWT_EXPIRES_IN` (server-side tokens), `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`/`SMTP_MESSAGE_DOMAIN` (worker mail), `NOTIFICATION_POLL_MS`/`NOTIFICATION_MAX_ATTEMPTS`/`NOTIFICATION_RETRY_BASE_MS` (worker retry), `NOTIFICATION_ENCRYPTION_KEY` (OTP email payload encryption), and optional `ADMIN_NOTIFICATION_EMAIL`. The one-time seed separately uses `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME`, and `ADMIN_PHONE`.
- Compose sets `NODE_ENV=production` and `PORT=4000` and constructs `DATABASE_URL` from `POSTGRES_*`; optional backend `DB_POOL_MAX` keeps its default of 10. `SMTP_TEST_TRANSPORT` is test-only and is not passed in production.
- Initial admin creation uses the existing `npm run db:seed-admin` script once after migrations and backend health. The `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME`, and `ADMIN_PHONE` values are read interactively, passed only to that one-off process, then unset; they are not part of `.env.production`. The script bcrypt-hashes the password and will not promote a non-admin account.
- `infra/terraform/security.tf` already permits inbound public TCP 80/443 and restricts SSH TCP 22 to the configured admin `/32`; it has no API or PostgreSQL ingress. A real DNS record must point the configured domain to the EC2 address for Caddy HTTPS. Ansible prepares `/opt/foodloop/{config,backups,logs}` with `ec2-user:docker`, mode `0750`; it does not install AWS CLI v2, whose manual install is documented in the runbook.
- Once domain-based HTTPS is configured, smoke test `curl --fail --show-error https://<domain>/api/health` and `curl --fail --show-error https://<domain>/api/v1`; the health route checks PostgreSQL connectivity. The detailed runbook also verifies worker health, no host mapping for PostgreSQL port 5432, persistent volume name, and database backups. Do not count the current HTTP dashboard render as these checks.
- Roll back application images by changing `IMAGE_TAG` to a retained prior immutable tag, then run `docker compose --env-file config/.env.production -f compose.prod.yml pull frontend backend worker` and `docker compose --env-file config/.env.production -f compose.prod.yml up -d frontend backend worker`. The pinned project name and explicit volumes preserve `foodloop_pgdata_prod`, `foodloop_caddy_data`, and `foodloop_caddy_config`; do not remove or recreate them. Review migration compatibility before running an older image against a newer schema.
- The pinned Nginx image version and configuration were prepared locally. Nginx CLI validation was unavailable on the workstation; the production Nginx configuration has not been validated by starting a container or reaching EC2.

### Phase 10 — GitHub Actions CI/CD (pending)

Automate the agreed build/test/security-scan/image-push/deployment workflow only after Phase 9 is working manually. Do not store AWS credentials or application secrets in workflow files.

### Phase 11 — Nagios monitoring (pending)

Add and verify the planned Nagios monitoring and alerting after the deployed services and health checks are established.

### Phase 12 — Integration testing, evidence, and final report (pending)

Run end-to-end integration checks, capture real execution evidence, document results and remaining limitations, and prepare the final project/viva report. Do not fabricate deployment or monitoring results.

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

| Path                                             | Role      | Screen/workflow                                                 |
| ------------------------------------------------ | --------- | --------------------------------------------------------------- |
| `/`                                              | Public    | Landing page                                                    |
| `/login`                                         | Public    | Email/password login                                            |
| `/register`                                      | Public    | Donor, NGO, or volunteer registration                           |
| `/dashboard/donor`                               | Donor     | Donor overview                                                  |
| `/dashboard/donor/donations`                     | Donor     | Donation listings                                               |
| `/dashboard/donor/donations/new`                 | Donor     | Create donation                                                 |
| `/dashboard/donor/donations/:id`                 | Donor     | Donation detail and management                                  |
| `/dashboard/donor/reservations`                  | Donor     | Incoming reservation requests                                   |
| `/dashboard/donor/reservations/:id`              | Donor     | Reservation, assignment, and pickup/delivery status             |
| `/dashboard/donor/history`                       | Donor     | Donation history                                                |
| `/dashboard/donor/notifications`                 | Donor     | Notifications                                                   |
| `/dashboard/ngo`                                 | NGO       | Recipient overview                                              |
| `/dashboard/ngo/available`                       | NGO       | Browse eligible food                                            |
| `/dashboard/ngo/available/:id`                   | NGO       | Donation detail and request flow                                |
| `/dashboard/ngo/reservations`                    | NGO       | Reservations and history                                        |
| `/dashboard/ngo/reservations/:id`                | NGO       | Reservation and volunteer assistance                            |
| `/dashboard/ngo/notifications`                   | NGO       | Notifications                                                   |
| `/dashboard/volunteer`                           | Volunteer | Volunteer overview                                              |
| `/dashboard/volunteer/profile`                   | Volunteer | Location and availability                                       |
| `/dashboard/volunteer/available`                 | Volunteer | Available assignments                                           |
| `/dashboard/volunteer/tasks`                     | Volunteer | Active assignments                                              |
| `/dashboard/volunteer/tasks/:id`                 | Volunteer | Assignment detail and OTP verification                          |
| `/dashboard/volunteer/completed`                 | Volunteer | Completed work                                                  |
| `/dashboard/volunteer/history`                   | Volunteer | Task history                                                    |
| `/dashboard/volunteer/notifications`             | Volunteer | Notifications                                                   |
| `/dashboard/admin`                               | Admin     | Admin overview                                                  |
| `/dashboard/admin/organizations`                 | Admin     | Organization review queue                                       |
| `/dashboard/admin/users` (also role filters)     | Admin     | User management/listing                                         |
| `/dashboard/admin/donations`                     | Admin     | Donation inspection                                             |
| `/dashboard/admin/reservations`                  | Admin     | Reservation inspection                                          |
| `/dashboard/admin/activity`                      | Admin     | Admin-scoped notifications/activity                             |
| `/dashboard/admin/notifications`                 | Admin     | Email queue/worker monitoring                                   |
| `/dashboard/admin/analytics`                     | Admin     | Impact analytics                                                |
| `/dashboard/admin/trust`                         | Admin     | Access/trust page                                               |
| `/dashboard/admin/tasks`, `/devops`, `/settings` | Admin     | Explicit placeholders; these full workflows are not implemented |

Unknown routes display a 404 page. Placeholder pages explicitly say that planned information is not fabricated.

## 6. Backend API reference

API base path is `/api/v1` unless shown otherwise. Successful API responses use `{ "data": ... }`; error responses use `{ "error": { "code", "message", ... } }`. Protected routes require `Authorization: Bearer <JWT>`.

### Health and identity

| Method | Path                        | Access                                          | Purpose                                   |
| ------ | --------------------------- | ----------------------------------------------- | ----------------------------------------- |
| GET    | `/api/health`               | Public                                          | API and PostgreSQL health check           |
| GET    | `/api/v1`                   | Public                                          | API identity/version                      |
| POST   | `/api/v1/auth/register`     | Public, rate-limited                            | Register donor/NGO/volunteer              |
| POST   | `/api/v1/auth/login`        | Public, rate-limited                            | Email/password login                      |
| POST   | `/api/v1/auth/enroll-phone` | Public, rate-limited; requires current password | Add phone to legacy account               |
| GET    | `/api/v1/auth/me`           | Authenticated                                   | Return authenticated identity             |
| POST   | `/api/v1/organizations`     | Donor/NGO                                       | Add an organization                       |
| GET    | `/api/v1/organizations/me`  | Donor/NGO                                       | Current user’s organization/service areas |

Registration password policy is at least 12 characters, including uppercase, lowercase, and a number. Login accepts at least 6 characters for legacy compatibility. Public registration does not accept the admin role.

### Administration

| Method | Path                                           | Access | Purpose                                        |
| ------ | ---------------------------------------------- | ------ | ---------------------------------------------- |
| GET    | `/api/v1/admin/overview`                       | Admin  | Counts and recent users/reviews                |
| GET    | `/api/v1/admin/users`                          | Admin  | Paginated/searchable user list                 |
| GET    | `/api/v1/admin/organizations`                  | Admin  | Paginated organization review list and filters |
| PATCH  | `/api/v1/admin/organizations/:id/verification` | Admin  | Verify/reject and record review metadata       |
| GET    | `/api/v1/admin/donations`                      | Admin  | Inspect/filter donation records                |
| GET    | `/api/v1/admin/reservations`                   | Admin  | Inspect/filter reservation records             |

### Donations and reservations

| Method | Path                                 | Access           | Purpose                         |
| ------ | ------------------------------------ | ---------------- | ------------------------------- |
| POST   | `/api/v1/donations`                  | Verified donor   | Publish donation                |
| GET    | `/api/v1/donations/mine`             | Donor            | List own donations              |
| GET    | `/api/v1/donations/available`        | NGO              | Browse eligible local donations |
| GET    | `/api/v1/donations/:id`              | Donor/NGO/Admin  | Authorized donation detail      |
| PATCH  | `/api/v1/donations/:id`              | Owner donor      | Edit a listing                  |
| POST   | `/api/v1/donations/:id/cancel`       | Owner donor      | Cancel a listing                |
| POST   | `/api/v1/donations/:id/reservations` | Verified NGO     | Request a quantity              |
| GET    | `/api/v1/reservations/mine`          | NGO              | List own reservations           |
| GET    | `/api/v1/reservations/received`      | Donor            | List requests received by donor |
| GET    | `/api/v1/reservations/:id`           | Authorized party | Reservation detail              |
| PATCH  | `/api/v1/reservations/:id/accept`    | Donor            | Accept request                  |
| PATCH  | `/api/v1/reservations/:id/reject`    | Donor            | Reject request                  |
| POST   | `/api/v1/reservations/:id/cancel`    | NGO              | Cancel own reservation          |

List routes accept pagination and relevant filters such as status, search, category, and location. Request schemas enforce bounded page sizes and field values.

### Volunteers, assignments, and OTPs

| Method | Path                                            | Access                    | Purpose                                    |
| ------ | ----------------------------------------------- | ------------------------- | ------------------------------------------ |
| GET    | `/api/v1/volunteers/me`                         | Volunteer                 | View profile                               |
| PATCH  | `/api/v1/volunteers/me`                         | Volunteer                 | Update location/availability               |
| POST   | `/api/v1/reservations/:id/assignments`          | NGO                       | Request assistance on accepted reservation |
| GET    | `/api/v1/reservations/:id/assignments`          | Donor/NGO party           | View assignment state                      |
| GET    | `/api/v1/volunteers/assignments/available`      | Volunteer                 | Browse eligible offers                     |
| GET    | `/api/v1/volunteers/assignments/mine`           | Volunteer                 | View assignments/history                   |
| GET    | `/api/v1/assignments/:id`                       | Authorized party          | Assignment details                         |
| POST   | `/api/v1/assignments/:id/accept`                | Eligible volunteer        | Accept offer                               |
| POST   | `/api/v1/assignments/:id/reject`                | Eligible volunteer        | Decline offer                              |
| POST   | `/api/v1/assignments/:id/cancel`                | Authorized workflow party | Cancel assignment                          |
| POST   | `/api/v1/assignments/:id/pickup-otp/dev-code`   | Donor; development only   | Retrieve development code                  |
| POST   | `/api/v1/assignments/:id/delivery-otp/dev-code` | NGO; development only     | Retrieve development code                  |
| POST   | `/api/v1/assignments/:id/pickup-otp/issue`      | Donor                     | Queue pickup OTP email                     |
| POST   | `/api/v1/assignments/:id/delivery-otp/issue`    | NGO                       | Queue delivery OTP email                   |
| POST   | `/api/v1/assignments/:id/pickup-otp/verify`     | Assigned volunteer        | Verify pickup code                         |
| POST   | `/api/v1/assignments/:id/delivery-otp/verify`   | Assigned volunteer        | Verify delivery code                       |

OTP issue/verification endpoints are rate-limited. Codes expire after the configured workflow expiry and have bounded verification attempts. Production email depends on both SMTP and the encryption key being configured.

### Notifications, SSE, analytics, and monitoring

| Method | Path                                   | Access             | Purpose                                                        |
| ------ | -------------------------------------- | ------------------ | -------------------------------------------------------------- |
| GET    | `/api/v1/notifications`                | Authenticated user | Paginated own notification history; `unread=true/false` filter |
| GET    | `/api/v1/notifications/unread-count`   | Authenticated user | Own unread count                                               |
| PATCH  | `/api/v1/notifications/:id/read`       | Owner only         | Mark one notice read                                           |
| PATCH  | `/api/v1/notifications/read-all`       | Authenticated user | Mark own notices read                                          |
| GET    | `/api/v1/events/stream`                | Authenticated user | User-scoped SSE with optional `Last-Event-ID` header           |
| GET    | `/api/v1/analytics/overview`           | Admin              | Platform impact/operations summary                             |
| GET    | `/api/v1/analytics/donations/monthly`  | Admin              | Recent monthly donations and unit-grouped quantities           |
| GET    | `/api/v1/analytics/donations/locality` | Admin              | Donation totals by locality and unit                           |
| GET    | `/api/v1/analytics/reservations`       | Admin              | Reservation counts by status                                   |
| GET    | `/api/v1/analytics/delivery`           | Admin              | OTP-verified pickup/delivery completion rates                  |
| GET    | `/api/v1/admin/notifications/stats`    | Admin              | Queue counts, worker heartbeat, recent event aggregates        |
| GET    | `/api/v1/admin/notifications`          | Admin              | Paginated/filterable queue records; no body or OTP exposure    |

## 7. Database schema and migrations

The migration runner processes numbered SQL files in order and records them in `schema_migrations`. Each unapplied migration runs in a transaction. Existing migration files should be treated as immutable after they have been applied; introduce a higher numbered migration for later changes.

| Migration                                   | Purpose                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `001_initial.sql`                           | Core users, organizations, service areas, donations, reservations, volunteer profiles, assignments, notification queue, indexes      |
| `002_organization_verification.sql`         | Reviewer, review timestamp, and note fields on organizations                                                                         |
| `003_required_phone_identity.sql`           | E.164 phone identity and unique indexes while retaining legacy phone compatibility                                                   |
| `004_donation_reservations_workflow.sql`    | Donation storage/location workflow fields, quantity accounting, expanded statuses/categories/units, reservation metadata and indexes |
| `005_volunteer_assignment_verification.sql` | Volunteer profile metadata, assignment states/OTP attempts and expiries, assignment rejection records, delivered quantity field      |
| `006_backfill_verified_deliveries.sql`      | Reconciles legacy verified deliveries and backfills delivered quantities                                                             |
| `007_notifications_events_worker.sql`       | Extends email queue; creates in-app notifications, durable user events, worker state; adds business notification triggers            |
| `008_admin_business_events.sql`             | Adds administrator business activity, assignment-decline events, and worker operational events                                       |

Core tables:

| Table                       | Contents and key relationships                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                     | UUID, unique email, bcrypt hash, role, full name, legacy and E.164 phone, active flag, timestamps                                            |
| `organizations`             | Owner user, donor/recipient type, verification state, address/locality/pincode, reviewer, note, verification timestamp                       |
| `service_areas`             | Organization’s additional city/locality/pincode matching areas                                                                               |
| `donations`                 | Donor organization, food/category, total/reserved/remaining/delivered quantity, unit, preparation/storage, pickup location, deadline, status |
| `reservations`              | Donation, recipient organization, quantity, status, optional message/reason, timestamps                                                      |
| `volunteer_profiles`        | Volunteer’s city/locality/pincode and availability                                                                                           |
| `reservation_assignments`   | Reservation, assigned volunteer, state, offer/accept timestamps, hashed OTP values/expiry/attempt counts, verification timestamps            |
| `assignment_rejections`     | Volunteer-specific rejection history for an assignment                                                                                       |
| `notification_queue`        | Recipient email, subject/body, event type, status/attempts/retry timestamps, optional encrypted payload, idempotency key                     |
| `in_app_notifications`      | Recipient, event type, safe title/message/metadata, resource pointer, read timestamp, idempotency key                                        |
| `user_events`               | Durable recipient-scoped event stream and replay IDs for SSE                                                                                 |
| `notification_worker_state` | Worker start/heartbeat/stop timestamps, last error and completed job count                                                                   |
| `schema_migrations`         | Migration filename and applied timestamp                                                                                                     |

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

- The user reports Phase 7 provisioning and Phase 8 host configuration/verification complete. AWS live drift has not been independently checked during this documentation update. For Phase 9, user-supplied evidence reports immutable ECR image pushes and a donor dashboard render over temporary EC2 HTTP; broader deployment verification and hardening remain pending as described above.
- Phase 9 is partial; Phases 10–12 remain pending. Puppet is excluded from the roadmap.
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
- [Phase 7 Terraform implementation and instructions](infra/terraform/README.md)
- [Phase 8 Ansible host configuration and instructions](infra/ansible/README.md)
- [Phase 9 production deployment runbook](infra/deploy/README.md)
- [Database migrations](database/migrations/)
