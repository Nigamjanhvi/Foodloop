# FoodLoop Phase 9 — EC2 deployment runbook

This runbook prepares the existing Amazon Linux 2023 x86_64 EC2 host in `ap-south-1` to run the FoodLoop application from the existing private ECR repositories. It does not provision or change AWS resources. The existing root `docker-compose.yml` remains the local development setup and is not used or replaced here.

## Phase 9 deployment progress (user-reported)

Phase 9 has reached a partial deployment. The user reports the following milestones; this documentation update did not contact AWS or independently verify the host, ECR, or browser:

- Existing EC2 instance: `i-0998980f6f7059da3`, Amazon Linux 2023, x86_64, `t3.small`, region `ap-south-1`. The user reports successful SSH access and Docker Engine `25.0.14` / Docker Compose `v5.8.0` verification.
- Release tag `p9-20261124-222955` was built for the EC2 architecture and pushed to the existing ECR repositories. The user reports verifying both pushes with ECR image-describe commands.
  - Frontend: `247558788371.dkr.ecr.ap-south-1.amazonaws.com/foodloop-frontend:p9-20261124-222955`
  - Frontend digest: `sha256:b1719f0887ee3c6dac87e54c10e33a0e56eab1399a39587622d38cec62209e25`
  - Backend: `247558788371.dkr.ecr.ap-south-1.amazonaws.com/foodloop-backend:p9-20261124-222955`
  - Backend digest: `sha256:90a0ef47dbcc6453bb07cb6ee3bcd132a37848b675e309c3b547efdf35e82b9e`
- The user reports transferring the production Compose and Caddy files to `/opt/foodloop`, creating `/opt/foodloop/config/.env.production` on EC2 with restrictive permissions, and authenticating to ECR there with the EC2 instance role. No environment values or credentials are included in this documentation.
- The temporary EC2 Caddy configuration reportedly listened on port 80 and proxied to `frontend:8080`. The user reports opening `http://13.200.252.1/dashboard/donor`; the donor dashboard rendered, showed the donor organization's pending administrator verification status, and displayed the UI's “Live” indicator. The public IP can change after stop/start.
- The repository's `Caddyfile` below the deployment directory is configured for domain-based HTTPS. It is not the same as the reported temporary HTTP configuration; use the domain/TLS configuration only after DNS and environment values are ready. Do not send credentials or use real accounts over HTTP.

This browser observation confirms only that the dashboard route rendered. It does not verify API or database health, SSE event delivery, container health, PostgreSQL persistence, migrations, worker/SMTP operation, admin bootstrap, or donor/NGO/volunteer/admin workflows. SMTP was postponed; no production admin bootstrap or full integration testing is confirmed. The worker's health is not confirmed. Previously shared JWT, database, and encryption secrets must be rotated before secure production operation. Therefore Phase 9 remains partial and is not a hardened public production deployment.

### Next verification and hardening sequence

1. Confirm the current EC2 public address and configure a real DNS A record. Configure the domain-based `Caddyfile` and set `FOODLOOP_DOMAIN` and matching HTTPS `CORS_ORIGIN` in the private EC2 environment file. Rotate previously shared secrets before accepting real users. Never paste secret values into shell commands or documentation.
2. Review file permissions as described above, transfer only the non-secret repository `compose.prod.yml` and domain-based `Caddyfile`, and confirm the intended unique tag is in the private environment file. The documented release tag is `p9-20261124-222955`; it is immutable, so do not attempt to push another image using it.
3. On EC2, validate configuration and reconcile the running stack with the repository's pinned project and volume names. These commands do not remove named volumes:

   ```bash
   cd /opt/foodloop
   docker compose --env-file config/.env.production -f compose.prod.yml config --quiet
   docker compose --env-file config/.env.production -f compose.prod.yml pull
   docker compose --env-file config/.env.production -f compose.prod.yml up -d
   docker compose --env-file config/.env.production -f compose.prod.yml ps
   docker compose --env-file config/.env.production -f compose.prod.yml logs --tail=100 postgres backend worker frontend caddy
   ```

   Do not proceed to credentialed browser tests while the site is HTTP. Because the EC2 deployment was not independently inspected, first confirm service and volume state before changing configuration; do not run volume deletion or pruning commands.
4. After HTTPS is serving the configured domain, run the smoke checks below, inspect the backend migration and database health output, verify the PostgreSQL mount and absence of host port mappings, and verify the worker only after SMTP is configured. The repository health route is not evidence of the separate worker's SMTP delivery.
5. After database/backend readiness, use the existing one-time admin bootstrap procedure in this runbook, then test admin login and organization review. Do not repeat a successful seed.
6. Test real donor, NGO, volunteer, and admin journeys; verify backup and recovery in a planned, safe manner; retain genuine evidence with personal data redacted.

## What the repository actually runs

- The unchanged local `docker-compose.yml` builds from the repository root (`context: .`) with `frontend/Dockerfile` and `backend/Dockerfile`. Production builds the frontend from the same root context with `frontend/Dockerfile.prod` and the backend with `backend/Dockerfile`. The backend image is also used by the worker.
- `frontend/src/api/client.ts` and the SSE client both default to same-origin `/api/v1`. `VITE_API_URL` is a Vite build-time value; production leaves it unset so the emitted static app uses `/api/v1`.
- The production frontend image serves the built static files with Nginx on internal port `8080`. `infra/deploy/nginx.prod.conf` sends `/api/` to `backend:4000`; its `proxy_pass` has no URI suffix, so the original `/api/...` path and query are preserved. It forwards Host, Authorization and forwarded-protocol headers, disables response buffering for authenticated SSE, and falls back to `index.html` for React Router routes. The Compose health check fetches `/` on `127.0.0.1:8080`, matching the Nginx listener and static root. Caddy terminates HTTPS and proxies to Nginx.
- The backend listens on container port `4000`. `GET /api/health` checks PostgreSQL; `GET /api/v1` is the API version route. The backend container runs the existing migration command before starting its API process.
- The worker uses the same backend image and the existing `npm run notifications:worker` command. The image contains the worker source and `tsx` dependency. The worker requires working SMTP settings and verifies its SMTP connection during startup.
- PostgreSQL is `postgres:16-alpine`; migrations are in `database/migrations/` and are tracked in `schema_migrations`. Data is kept in the named volume `foodloop_pgdata_prod`.
- Terraform already defines immutable, scan-on-push ECR repositories `foodloop-frontend` and `foodloop-backend`. EC2's existing `foodloop-ec2-role` has `ecr:GetAuthorizationToken` and repository-scoped image-pull actions. The role is for pulls, not pushes.
- Ansible has prepared `/opt/foodloop`, `/opt/foodloop/config`, `/opt/foodloop/backups`, and `/opt/foodloop/logs`, owned by `ec2-user:docker` with mode `0750`. It installs Docker and Compose V2, but its current roles do not install AWS CLI.

The production Compose file pins project name `foodloop-prod`. Caddy is the only service publishing host ports: TCP 80 and 443. The frontend Nginx listens on internal port 8080; the API, worker, and PostgreSQL have no host port mappings. PostgreSQL is on an internal Docker network. Named volumes have explicit stable names: `foodloop_pgdata_prod`, `foodloop_caddy_data` mounted at `/data`, and `foodloop_caddy_config` mounted at `/config`; ordinary `up`, service recreation, and image rollback do not delete them.

### Before a public production launch

You need a DNS name whose A record points to the instance's current public IP. Caddy uses that name to obtain and renew HTTPS certificates; keep TCP 80 and 443 reachable as already allowed by the Terraform security group. The instance has a public address that can change after stop/start, so update DNS when it changes or arrange a stable address. Do not submit real account credentials over plain HTTP.

Production uses the separate static Nginx runtime in `frontend/Dockerfile.prod`; the original `frontend/Dockerfile` and root local Compose behavior remain unchanged. The Nginx base uses an explicit version tag. Nginx configuration is copied into the image, provides SPA fallback and `/api/` proxying, and keeps SSE responses unbuffered.

## Production environment file

`infra/deploy/.env.production.example` contains placeholders only. Do not create a real `.env.production` in the repository, copy secrets from it, or transfer real credentials from the workstation. Create the real file directly on EC2 in an interactive SSH session as `ec2-user`.

```bash
# First inspect ownership and mode only; this does not display file contents.
sudo stat -c '%U:%G %a %n' /opt/foodloop /opt/foodloop/config /opt/foodloop/config/.env.production 2>/dev/null || true

# Tighten config access to ec2-user and root; this child directory is private.
sudo install -d -o ec2-user -g ec2-user -m 0700 /opt/foodloop/config
sudo chown ec2-user:ec2-user /opt/foodloop/config
sudo chmod 0700 /opt/foodloop/config
stat -c '%U:%G %a %n' /opt/foodloop/config

# Create only if missing. Never truncate an existing environment file.
umask 077
if [ -L /opt/foodloop/config/.env.production ]; then
  echo 'The production environment path is a symlink; refusing to edit it.'
  exit 1
fi
if [ ! -e /opt/foodloop/config/.env.production ] && ! (set -C; : > /opt/foodloop/config/.env.production); then
  echo 'Could not safely create the production environment file.'
  exit 1
fi
if [ ! -f /opt/foodloop/config/.env.production ]; then
  echo 'The production environment path is not a regular file; refusing to edit it.'
  exit 1
fi
sudo chown ec2-user:ec2-user /opt/foodloop/config/.env.production
sudo chmod 0600 /opt/foodloop/config/.env.production
stat -c '%U:%G %a %n' /opt/foodloop/config/.env.production
nano /opt/foodloop/config/.env.production
chmod 0600 /opt/foodloop/config/.env.production
stat -c '%U:%G %a %n' /opt/foodloop/config/.env.production
```

Expected metadata is owner `ec2-user`, mode `700` for the config directory and mode `600` for the file. `sudo`/root can still access it. The Ansible-prepared parent `/opt/foodloop` remains owned by `ec2-user:docker`; the private child directory prevents group members from traversing into it. If `stat` reports different ownership before correction, review it before proceeding. Use the interactive editor to enter values; do not use `cat`, `echo`, `printenv`, shell tracing, or commands that print the file or environment. Do not SCP the real file. Compose reads it with `--env-file` and passes only the explicitly declared service variables to containers.

Operational note: the current Phase 8 Ansible directory loop also applies mode `0750` to `/opt/foodloop/config`. If `infra/ansible/site.yml` is ever rerun after deployment, immediately repeat the `chown`/`chmod 0700` config-directory and `chmod 0600` environment-file steps before starting Compose or allowing other Docker-group users access. The current host setup does not make this manual hardening persistent across Ansible reruns.

Set these values:

| Variable | Purpose |
|---|---|
| `ECR_REGISTRY` | `<AWS account ID>.dkr.ecr.ap-south-1.amazonaws.com`; used to select the existing ECR images. |
| `IMAGE_TAG` | A unique immutable release tag, such as a Git commit ID. Do not reuse a tag; the ECR repositories are immutable. |
| `FOODLOOP_DOMAIN` | DNS host name pointing to this EC2 instance; Caddy uses it for HTTPS certificates. |
| `CORS_ORIGIN` | The browser origin, exactly `https://<FOODLOOP_DOMAIN>`. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database initialization values. Use a strong URL-safe password because the backend `DATABASE_URL` is assembled from them. Existing initialized volumes retain their existing database credentials; changing these values does not rotate a database user's password. |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Backend JWT signing secret (at least 32 bytes) and token lifetime. The secret stays server-side. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_MESSAGE_DOMAIN` | Nodemailer SMTP connection and message identity. `SMTP_USER` and `SMTP_PASSWORD` may be empty only for a relay that does not require authentication. The worker will not become healthy if SMTP verification fails. |
| `NOTIFICATION_POLL_MS`, `NOTIFICATION_MAX_ATTEMPTS`, `NOTIFICATION_RETRY_BASE_MS` | Existing worker poll/retry settings. |
| `NOTIFICATION_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes; encrypts emailed pickup/delivery OTP payloads. Keep it stable across restarts and backups. |
| `ADMIN_NOTIFICATION_EMAIL` | Optional address used by the application for admin notification behavior. |

Compose sets `NODE_ENV=production` and `PORT=4000`, and constructs `DATABASE_URL` from the three `POSTGRES_*` values; do not set a host-facing database URL. The backend also accepts optional `DB_POOL_MAX` (default `10`), but this production Compose file leaves the default. `SMTP_TEST_TRANSPORT` is test-only and is intentionally not configured.

Generate secrets with a trusted password manager or secret generator and enter them directly in the EC2 editor; do not print them in a terminal or put them in command arguments or shell history. Use a URL-safe random password for `POSTGRES_PASSWORD` because the application builds `DATABASE_URL` from it.

The Compose variables listed above provide image selection and service configuration. `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME`, and `ADMIN_PHONE` are **not** runtime variables in this Compose file. The existing `db:seed-admin` script requires them only for initial administrator bootstrap; `ADMIN_PASSWORD` must be 16–128 characters and `ADMIN_PHONE` must pass the existing E.164 phone schema. Do not put these values into `.env.production` or the normal app environment.

Run the existing root script only once after the production database migrations have completed and the backend is healthy, before onboarding users. Enter the credentials interactively in the EC2 SSH shell; the password prompt is silent, the values are not placed in shell history or command arguments, and they are unset after the one-off process:

```bash
cd /opt/foodloop
# Verify the API is healthy and migrations are current before proceeding.
docker compose --env-file config/.env.production -f compose.prod.yml ps backend
docker compose --env-file config/.env.production -f compose.prod.yml logs --tail=50 backend
read -r -p 'Admin email: ' ADMIN_EMAIL
read -r -s -p 'Admin password (16-128 characters): ' ADMIN_PASSWORD; printf '\n'
read -r -p 'Admin full name: ' ADMIN_FULL_NAME
read -r -p 'Admin phone (E.164): ' ADMIN_PHONE
export ADMIN_EMAIL ADMIN_PASSWORD ADMIN_FULL_NAME ADMIN_PHONE
if docker compose --env-file config/.env.production -f compose.prod.yml run --rm -T --no-deps -e ADMIN_EMAIL -e ADMIN_PASSWORD -e ADMIN_FULL_NAME -e ADMIN_PHONE backend npm run db:seed-admin >/dev/null; then
  unset ADMIN_EMAIL ADMIN_PASSWORD ADMIN_FULL_NAME ADMIN_PHONE
  printf 'Admin bootstrap command completed successfully.\n'
else
  SEED_STATUS=$?
  unset ADMIN_EMAIL ADMIN_PASSWORD ADMIN_FULL_NAME ADMIN_PHONE
  printf 'Admin bootstrap failed. Review the error and confirm account state before any retry.\n'
  exit "$SEED_STATUS"
fi
```

The script hashes the password with bcrypt. It creates an admin only if the email is not already registered; it refuses to promote a non-admin account. For an existing admin without a phone, it requires the matching existing password before adding a phone; an admin with a phone is rejected without changes. Do not rerun after a successful seed: confirm the new admin can sign in. The command suppresses the script's success line so the admin email is not echoed. Do not enable shell tracing while values are loaded or print the process environment. The `ADMIN_*` values are not stored in `.env.production` and do not remain in the shell after this command.

## Build and push from Windows PowerShell

Run from the repository root with Docker Desktop/buildx and the AWS CLI profile `foodloop-admin` already configured. Use a new unique tag each time because ECR tag immutability is enabled.

```powershell
$Region = "ap-south-1"
$AccountId = (aws sts get-caller-identity --profile foodloop-admin --query Account --output text).Trim()
if ($LASTEXITCODE -ne 0 -or $AccountId -notmatch '^\d{12}$') { throw "Could not resolve the AWS account from profile foodloop-admin." }
$Registry = "$AccountId.dkr.ecr.$Region.amazonaws.com"
$ImageTag = Read-Host "Enter a unique release tag (for example, a Git commit ID)"
if ($ImageTag -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$' -or $ImageTag -eq "latest") { throw "Use a valid, unique version tag, not latest." }
$FrontendImage = "${Registry}/foodloop-frontend:${ImageTag}"
$BackendImage = "${Registry}/foodloop-backend:${ImageTag}"

docker buildx build --platform linux/amd64 --load --file frontend/Dockerfile.prod --tag $FrontendImage .
if ($LASTEXITCODE -ne 0) { throw "Frontend image build failed." }
docker buildx build --platform linux/amd64 --load --file backend/Dockerfile --tag $BackendImage .
if ($LASTEXITCODE -ne 0) { throw "Backend image build failed." }

aws ecr get-login-password --region $Region --profile foodloop-admin |
  docker login --username AWS --password-stdin $Registry
if ($LASTEXITCODE -ne 0) { throw "ECR login failed." }

docker push $FrontendImage
if ($LASTEXITCODE -ne 0) { throw "Frontend image push failed." }
docker push $BackendImage
if ($LASTEXITCODE -ne 0) { throw "Backend image push failed." }
```

The local profile needs ECR push permissions for both existing repositories: `ecr:GetAuthorizationToken` plus `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, and `ecr:PutImage` on those repositories. This runbook does not check or change the profile's policy.

## Copy files and deploy from WSL/Linux

Open WSL in the repository. Use the **current** EC2 public address; do not copy an old address from documentation. The SSH key is the existing local key; in the previously used root WSL setup it is `/root/.ssh/foodloop-key.pem`.

```bash
cd /mnt/c/Users/janhv/OneDrive/Desktop/Foodloop
export EC2_HOST="<current-ec2-public-ip>"
export SSH_KEY="$HOME/.ssh/foodloop-key.pem"
ssh -i "$SSH_KEY" "ec2-user@$EC2_HOST" 'docker --version && docker compose version'
```

Transfer only the non-secret Compose and Caddy configuration files. Create `.env.production` directly on EC2 using the procedure above; do not SCP or otherwise transfer real environment values:

```bash
scp -i "$SSH_KEY" infra/deploy/compose.prod.yml infra/deploy/Caddyfile "ec2-user@$EC2_HOST:/opt/foodloop/"
ssh -i "$SSH_KEY" "ec2-user@$EC2_HOST" 'chmod 644 /opt/foodloop/compose.prod.yml /opt/foodloop/Caddyfile && stat -c "%U:%G %a %n" /opt/foodloop/config /opt/foodloop/config/.env.production'
```

Do not copy local AWS credentials or the private SSH key to EC2. Check whether AWS CLI is available on the host:

```bash
ssh -i "$SSH_KEY" "ec2-user@$EC2_HOST" 'aws --version && aws sts get-caller-identity --query Arn --output text'
```

The current Ansible role does not install AWS CLI, so that check may report `aws: command not found`. If so, install AWS CLI v2 on the host using the official Amazon Linux instructions before proceeding. The role already attached to EC2 supplies credentials through its instance profile; do not create a named AWS profile or copy local credentials. Confirm the caller identity is the EC2 assumed role before continuing.

If AWS CLI is absent, the official AWS CLI v2 Linux installer supports Amazon Linux 2023. These commands install it on x86_64; they are documented here but were not run on the EC2 host:

```bash
sudo dnf install -y unzip
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
sudo /tmp/aws/install
rm -rf /tmp/aws /tmp/awscliv2.zip
aws --version
```

On the EC2 host, authenticate Docker to the same regional registry using instance-role credentials, then pull and start the stack:

```bash
cd /opt/foodloop
REGISTRY="$(sed -n 's/^ECR_REGISTRY=//p' config/.env.production)"
aws ecr get-login-password --region ap-south-1 |
  docker login --username AWS --password-stdin "$REGISTRY"

docker compose --env-file config/.env.production -f compose.prod.yml config --quiet
docker compose --env-file config/.env.production -f compose.prod.yml pull
docker compose --env-file config/.env.production -f compose.prod.yml up -d
docker compose --env-file config/.env.production -f compose.prod.yml ps
```

The Compose project migrates PostgreSQL before the API starts. Review startup output and service logs:

```bash
docker compose --env-file config/.env.production -f compose.prod.yml logs --tail=100 postgres backend worker frontend caddy
```

## Smoke checks

Run from WSL/Linux after DNS points to this host and Caddy has obtained a certificate:

```bash
export FOODLOOP_DOMAIN="<your-configured-domain>"
curl --fail --show-error --location "https://$FOODLOOP_DOMAIN/"
curl --fail --show-error "https://$FOODLOOP_DOMAIN/api/health"
curl --fail --show-error "https://$FOODLOOP_DOMAIN/api/v1"
```

The health route is the repository's `GET /api/health`; it returns HTTP 200 only when PostgreSQL responds to `SELECT 1`. Check Compose health and the worker heartbeat on EC2:

```bash
cd /opt/foodloop
docker compose --env-file config/.env.production -f compose.prod.yml ps
docker compose --env-file config/.env.production -f compose.prod.yml exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker inspect "$(docker compose --env-file config/.env.production -f compose.prod.yml ps -q worker)" --format '{{.State.Health.Status}}'
docker inspect "$(docker compose --env-file config/.env.production -f compose.prod.yml ps -q postgres)" --format '{{json .NetworkSettings.Ports}}'
docker inspect "$(docker compose --env-file config/.env.production -f compose.prod.yml ps -q postgres)" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}'
```

Expected: the worker and PostgreSQL report `healthy`; PostgreSQL's `5432/tcp` mapping is `null` (not published on the EC2 host); its data mount is `foodloop_pgdata_prod`. Inspect backend logs for `Database migrations are current.` and verify the health JSON reports `database: connected`. Perform real account/login and role workflows over HTTPS; do not count a running container alone as a successful application smoke test.

## Backup and rollback

Before deploying an image that changes database schema, save a database backup to the prepared backups directory:

```bash
cd /opt/foodloop
umask 077
BACKUP_FILE="backups/foodloop-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file config/.env.production -f compose.prod.yml exec -T postgres \
  sh -c 'pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$BACKUP_FILE"
test -s "$BACKUP_FILE" && chmod 600 "$BACKUP_FILE"
```

To restore that custom-format backup, first make and verify a separate backup of the current database, stop writers, and restore during a planned maintenance window. `pg_restore --clean` replaces objects represented in the archive; practice against an isolated database before using it for recovery:

```bash
cd /opt/foodloop
BACKUP_FILE="backups/<verified-backup-file>.dump"
docker compose --env-file config/.env.production -f compose.prod.yml stop backend worker
docker compose --env-file config/.env.production -f compose.prod.yml exec -T postgres \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$BACKUP_FILE"
docker compose --env-file config/.env.production -f compose.prod.yml up -d backend worker
docker compose --env-file config/.env.production -f compose.prod.yml ps
```

Keep a protected copy off the EC2 root volume for disaster recovery. The restore command does not remove or recreate the PostgreSQL Docker volume.

To roll application code back, edit only `IMAGE_TAG` in `config/.env.production` to a previously pushed immutable tag, then:

```bash
docker compose --env-file config/.env.production -f compose.prod.yml pull frontend backend worker
docker compose --env-file config/.env.production -f compose.prod.yml up -d frontend backend worker
docker compose --env-file config/.env.production -f compose.prod.yml ps
```

The explicit Compose project name and volume names are independent of the current directory and release tag. This rollback leaves `foodloop_pgdata_prod`, `foodloop_caddy_data`, and `foodloop_caddy_config` intact. Do **not** run `docker compose down -v`, `docker volume prune`, or manually remove any of these volumes during rollback. The application runs forward SQL migrations at startup; inspect each migration for backward compatibility before rolling old code against a newer schema. A database restore is a separate recovery operation and should be planned from the saved backup, not improvised during an image rollback.

## Deployment prerequisites and remaining risks

- Configure DNS and TLS before public user login; Caddy needs a real domain and inbound TCP 80/443.
- Confirm the local `foodloop-admin` profile has ECR push permissions. Existing EC2 IAM policy only grants ECR token retrieval and image pulls, which is appropriate for the host.
- Install/verify AWS CLI v2 on EC2; this is not currently in the Ansible role. No local credentials are needed there.
- SMTP host, port, sender identity, optional authentication, and outbound access must be valid or the worker will fail health checks.
- There is no automated PostgreSQL backup policy in the inspected Compose/Terraform/Ansible files. Make and protect backups before schema-changing releases.
- Existing security group has no PostgreSQL ingress rule; production Compose also publishes no database port. Do not add one.
- The EC2 root disk is 30 GiB in the inspected Terraform defaults and the instance is `t3.small`; monitor disk and memory as images, logs, and database data grow.
- Image repositories are immutable and the lifecycle policy retains a configured finite count (default 10) of tagged images. Keep the prior release tag available until rollback is no longer needed.

During this documentation update, no AWS deployment command, remote SSH/SCP, image build/push, Terraform operation, or application test was run. The earlier ECR and temporary HTTP deployment milestones in this runbook are recorded from user-supplied evidence and were not independently rechecked here.

References: [AWS CLI v2 installation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), [private ECR registry authentication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html), [official Caddy image](https://hub.docker.com/_/caddy), [official Nginx 1.30.8 Alpine image](https://hub.docker.com/layers/library/nginx/1.30.8-alpine3.24/images/sha256-eb37f58646a901dc7727cf448cae36daaefaba79de33b5058dab79aa4c04aefb), and [NGINX stable release information](https://nginx.org/en/download.html).
