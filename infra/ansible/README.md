# FoodLoop Ansible — Phase 8 host configuration

Phase 8 prepares the existing Amazon Linux 2023 EC2 host for deployment. Ansible is run from the WSL control node and configures the remote server over SSH. It installs Docker Engine and the pinned Docker Compose V2 CLI plugin, sets safe Docker daemon log rotation, enables Docker, adds `ec2-user` to the Docker group, and creates the deployment directories.

**Phase 8 status:** The user confirms the Ansible configuration and verification steps completed successfully. The reported Docker socket permission issue was resolved by starting a fresh SSH session after Docker group membership was configured. No task counts, terminal output, or timestamps are asserted here.

This phase does **not** deploy FoodLoop containers, pull ECR images, configure production application secrets, or change AWS infrastructure. Phase 9 will use Ansible to deploy and update the existing Docker Compose application.

## Target and control-node architecture

```text
Windows 11 workstation
└── Ubuntu 24.04.5 on WSL 2 (Ansible control node)
    ├── /root/foodloop-ansible-venv (Ansible 14.6.0 / Core 2.21.6)
    ├── repository at /mnt/c/Users/janhv/OneDrive/Desktop/Foodloop
    └── SSH over the internet → ec2-user@current EC2 public IP
        └── Amazon Linux 2023 x86_64 EC2 (Docker host)
```

Ansible requires Python on the control node and a Python interpreter on the target. The inventory pins the remote interpreter to `/usr/bin/python3`. The target is the existing Amazon Linux 2023 EC2 instance; retrieve its current public IP and update the local inventory when it changes, including after an instance stop/start.

## SSH and execution status

An initial WSL private-key parsing error and a Docker group permission issue were reported during setup. The user confirms the Ansible configuration and verification steps have since completed, including resolving Docker access in a fresh SSH session. Do not publish key contents or assume the EC2 public IP remains constant.

## WSL setup and inventory

Open the Ubuntu WSL terminal, activate the existing environment, and enter this directory:

```bash
source /root/foodloop-ansible-venv/bin/activate
cd /mnt/c/Users/janhv/OneDrive/Desktop/Foodloop/infra/ansible
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
ansible --version
```

The repository is on a Windows-mounted WSL filesystem, which may appear world-writable to Ansible. Ansible ignores a project-local config discovered implicitly in that case. Explicitly setting `ANSIBLE_CONFIG` selects this project's config; only do this for a trusted checkout, keep the configuration reviewed, and retain host-key checking.

Create the ignored local inventory from the tracked example:

```bash
cp inventory.ini.example inventory.ini
```

The example defines group `foodloop_ec2`, host alias `foodloop-server`, SSH user `ec2-user`, and Python interpreter `/usr/bin/python3`. Set `ansible_host` in the local ignored `inventory.ini` to the EC2's current public IP. Do not add passwords, secrets, or private-key contents to inventory.

## SSH key path and connectivity checks

The private key path is resolved on the Ansible control machine. By default, the configuration uses `$HOME/.ssh/foodloop-key.pem`, which is `/root/.ssh/foodloop-key.pem` in the supplied root WSL environment. To override the location, export `FOODLOOP_SSH_KEY` before running Ansible:

```bash
export FOODLOOP_SSH_KEY="$HOME/.ssh/foodloop-key.pem"
```

Use the current EC2 address from the local inventory for an SSH connectivity check. Set it in the WSL shell without adding it to shared documentation:

```bash
export FOODLOOP_EC2_HOST="<current-ec2-public-ip>"
ssh -o StrictHostKeyChecking=ask -i "$FOODLOOP_SSH_KEY" "ec2-user@$FOODLOOP_EC2_HOST"
```

Accept the server host key only after verifying its fingerprint through a trusted channel. Then test Ansible connectivity:

```bash
ansible foodloop_ec2 -m ansible.builtin.ping
```

Do not paste the private key into a terminal, issue, chat, or repository. Keep host-key checking enabled in `ansible.cfg`.

## Local validation (does not connect to EC2)

From `infra/ansible` with the virtual environment active:

```bash
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
ansible --version
ansible-playbook --syntax-check -i inventory.ini.example site.yml
ansible-playbook --syntax-check -i inventory.ini.example verify.yml
ansible-inventory -i inventory.ini.example --graph
```

Syntax checks parse the playbooks and roles. They do not test SSH, install software, or modify the EC2 host. The example inventory is used so a local `inventory.ini` and private key are not needed for these checks.

## Phase 8 re-run (when host configuration needs to be reapplied)

From this directory, after SSH and the Ansible ping test pass:

```bash
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
ansible-playbook -i inventory.ini site.yml
ansible-playbook -i inventory.ini verify.yml
```

The playbooks use privilege escalation for package/service/configuration tasks. Amazon Linux's configured `ec2-user` sudo policy is expected to permit this. No Docker containers are started in this phase. Re-running `site.yml` is idempotent: already installed packages and matching configuration remain unchanged, except for an explicit optional full package update.

## What is configured

- **Common role:** asserts Amazon Linux 2023 x86_64, installs `curl`, `ca-certificates`, and Python 3 with DNF. Full package upgrades are off by default (`common_upgrade_all_packages: false`) and can be explicitly enabled in `group_vars/all.yml`.
- **Docker role:** installs the Amazon Linux 2023 `docker` DNF package, enables and starts the systemd service, and adds `ec2-user` to the `docker` group.
- **Compose V2:** downloads pinned Docker Compose v5.8.0 from the official Docker Compose GitHub release. The architecture is detected from Ansible facts; the release asset name is selected for x86_64 or aarch64. The official per-asset SHA-256 file is fetched and parsed, and `get_url` verifies the binary against that checksum before installation at `/usr/local/lib/docker/cli-plugins/docker-compose`.
- **Docker daemon:** installs `/etc/docker/daemon.json` from a Jinja2 template with `json-file` log rotation (`max-size: 10m`, `max-file: 3`). A handler restarts Docker only when that configuration changes.
- **Deployment directories:** creates `/opt/foodloop`, `config`, `backups`, and `logs`, owned by `ec2-user:docker` with mode `0750`. No secrets are written there.
- **Verification:** checks remote reachability, OS and architecture, active Docker service, Docker and Compose versions, daemon access, and required directories.

Docker group membership grants root-equivalent control of the host through the Docker socket. Only add trusted deployment administrators to this group. No TCP Docker API is enabled, no additional network ports are opened, and no PostgreSQL/API ports are exposed by these Ansible files.

## Troubleshooting

- **`error in libcrypto`:** if this parsing error recurs, check the local key file format and permissions without printing its contents. Do not generate a replacement key or change EC2/Terraform to bypass it.
- **SSH timeout/refused:** confirm the EC2 instance is running, the IP is current, and the existing security group allows port 22 from the current control-node public IP. This playbook does not change the security group.
- **Host key changed:** stop and verify the instance identity/fingerprint before removing any stale `known_hosts` entry. Never set `host_key_checking = False` or use `StrictHostKeyChecking=no` as a workaround.
- **Docker permission denied after adding the group:** existing SSH sessions keep their old group list. Start a fresh SSH session, then retry `docker info` as `ec2-user`. The user confirms this resolved the reported Phase 8 permission issue.
- **Compose checksum or download failure:** the task fails closed if the official checksum cannot be fetched or parsed. Check outbound HTTPS access and the pinned release asset; do not bypass checksum verification.

## Files

| File | Purpose |
|---|---|
| `ansible.cfg` | Secure defaults, inventory/roles paths, readable output, timeout, Python discovery |
| `inventory.ini.example` | Example inventory for the existing EC2 target |
| `group_vars/all.yml` | Configurable private-key path and common host setting |
| `site.yml` | Main idempotent host-preparation playbook |
| `verify.yml` | Separate checks for host, Docker, Compose, and directories |
| `roles/common/defaults/main.yml` | Common package list and optional upgrade default |
| `roles/common/tasks/main.yml` | OS/architecture assertion and DNF setup |
| `roles/docker/defaults/main.yml` | Docker, Compose version/path, user, architecture and directory defaults |
| `roles/docker/tasks/main.yml` | Docker installation/configuration and Compose checksum-verified install |
| `roles/docker/handlers/main.yml` | Restart Docker after daemon configuration changes |
| `roles/docker/templates/daemon.json.j2` | Docker JSON logging configuration |

The local `inventory.ini`, retry files, and `.vault_pass` are excluded by the root `.gitignore`. Phase 9 will deploy the existing FoodLoop Compose stack; that deployment is intentionally not part of these plays.
