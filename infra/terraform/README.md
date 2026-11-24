# FoodLoop AWS infrastructure (Phase 7)

This directory defines FoodLoop's AWS infrastructure: network, security boundary, instance role, two ECR repositories, and one EC2 host. Terraform does **not** install Docker, deploy the application, or configure the host; Ansible handles host configuration in Phase 8 and application deployment in Phase 9.

The user confirms that Phase 7 provisioning is complete and that the SSH inbound rule was updated to the current administrator IP. This documentation update does not run `terraform apply` or `terraform destroy`, and does not independently refresh AWS state.

## Architecture

```text
Internet
   | HTTP/HTTPS (80/443)
Internet Gateway -- Public route table -- Public subnet (10.20.1.0/24)
                                             |
                               EC2 (Amazon Linux 2023, x86_64)
                               SSH 22 from admin_cidr only
                               IAM role: pull only FoodLoop ECR images

ECR: foodloop-frontend (immutable, scan on push, AES-256)
ECR: foodloop-backend  (immutable, scan on push, AES-256)
```

Terraform describes one VPC (`10.20.0.0/16`), one public subnet in an available `ap-south-1` Availability Zone, an Internet Gateway, a public route table/default route, a security group, an EC2 IAM role and instance profile, two ECR repositories with lifecycle policies, and one EC2 instance. No NAT Gateway, RDS, load balancer, Elastic IP, EKS, or user data is created.

The instance uses the current Amazon Linux 2023 x86_64 AMI from AWS's public SSM parameter, a configurable instance type (default `t3.small`), the existing `foodloop-key` EC2 key pair, an encrypted 30 GiB gp3 root disk by default, and required IMDSv2. Its IAM policy grants ECR authorization-token access plus image-pull actions restricted to the two FoodLoop repository ARNs. The EC2 role is not granted administrator access.

## Prerequisites and AWS profile

- Windows PowerShell, Terraform CLI 1.5 or later (the requested environment reports Terraform 1.17.2), and AWS CLI v2.
- An authenticated AWS CLI profile named `foodloop-terraform` in region `ap-south-1`. Terraform uses this shared profile and does not contain credentials.
- The existing EC2 key pair `foodloop-key` in `ap-south-1`. Its private key remains in `$HOME\.ssh\foodloop-key.pem`; it is never read by Terraform or stored in this repository.
- The current administrator public IPv4 address in `/32` CIDR form. Refresh it immediately before use; a previous address can become stale.

The configured Terraform profile is expected to obtain temporary credentials through its existing `credential_process` bridge to `foodloop-admin`. For example, the AWS shared config can contain:

```ini
[profile foodloop-admin]
# Existing browser/SSO authentication settings are configured here.

[profile foodloop-terraform]
region = ap-south-1
credential_process = aws configure export-credentials --profile foodloop-admin --format process
```

Use the actual existing `foodloop-admin` authentication setup. Do not add access keys to this file, Terraform files, or `terraform.tfvars`. Verify the active identity before initializing or planning:

```powershell
aws sts get-caller-identity --profile foodloop-terraform --region ap-south-1
aws iam list-attached-user-policies --user-name janhvi --profile foodloop-admin
```

The provided CLI output shows that this IAM user currently has `AdministratorAccess`; consequently Terraform operations through the credential bridge inherit that broad operator permission. The EC2 instance role defined here is separately limited to pulling FoodLoop images. Avoid using the root account and consider a least-privilege operator identity for future work.

## Variables

Copy the example file to the ignored local variable file and update `admin_cidr` with the current public IP:

```powershell
Copy-Item .\infra\terraform\terraform.tfvars.example .\infra\terraform\terraform.tfvars
$myIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()
$adminCidr = "$myIp/32"
```

Edit `infra/terraform/terraform.tfvars` and set `admin_cidr` to the value of `$adminCidr`. Do not copy an old public IP from documentation. `terraform.tfvars` is ignored by Git. The example contains only a documentation-range placeholder and safe defaults.

| Variable | Default | Purpose |
|---|---|---|
| `aws_region` | `ap-south-1` | Resource region |
| `aws_profile` | `foodloop-terraform` | Shared AWS CLI profile |
| `project_name` | `foodloop` | Resource naming/tag prefix |
| `vpc_cidr` | `10.20.0.0/16` | VPC address range |
| `public_subnet_cidr` | `10.20.1.0/24` | Public subnet range |
| `instance_type` | `t3.small` | EC2 size; change only after checking regional availability/cost |
| `key_pair_name` | `foodloop-key` | Existing key-pair name; Terraform does not create a key |
| `admin_cidr` | required | Current administrator IPv4 `/32` for SSH |
| `root_volume_size` | `30` | Encrypted gp3 root disk size in GiB (8–16384) |
| `ecr_image_retention_count` | `10` | Number of newest tagged images retained per repository (1–1000) |

The ECR lifecycle policy expires untagged images after one day and retains only the configured count of the newest tagged images. Use immutable commit-SHA tags in the future CI workflow.

## Format, initialize, validate, and plan

Run from the Terraform directory. These commands inspect/configure local Terraform state and query AWS during planning; they do not create infrastructure until `apply` is run.

```powershell
Set-Location .\infra\terraform
terraform fmt -recursive
terraform init
terraform validate
terraform plan -var-file="terraform.tfvars"
```

Keep `.terraform.lock.hcl` in Git after `terraform init` so provider selections/checksums are reproducible. The `.terraform` plugin directory, state, plans, crash logs, and real `terraform.tfvars` are ignored. The initial state backend is Terraform's local state. Protect the state file because it can contain sensitive infrastructure metadata; never commit or casually share it.

### Validation status for this repository snapshot

- `terraform fmt -recursive`: completed.
- `terraform init`: completed; selected and locked `hashicorp/aws` v6.73.0 in `.terraform.lock.hcl`.
- `terraform validate`: passed.
- Phase 7 provisioning: reported complete by the user; the Terraform state was not refreshed against AWS as part of this documentation update.
- `terraform plan`: no current plan result is recorded here. Run it with the configured AWS profile to check for drift before any future infrastructure change.
- `terraform apply` and `terraform destroy`: not run as part of this documentation update.

### Provisioning (manual, cost-incurring)

Review every planned action and estimated cost before running:

```powershell
terraform apply -var-file="terraform.tfvars"
```

The apply command creates billable AWS resources. Review the plan and account state before running it. Terraform outputs provide IDs, addresses, ECR URLs, registry ID, and `ec2-user`; outputs do not include credentials or private keys. Refresh the current EC2 public IP for Ansible inventory after a stop/start. Keep the private key out of Git and restrict its Windows file permissions.

### Destroying resources

Destroy removes the Terraform-managed VPC, subnet, gateway, route table, security group, EC2 instance, role/profile, and ECR repositories:

```powershell
terraform plan -destroy -var-file="terraform.tfvars"
terraform destroy -var-file="terraform.tfvars"
```

Review the destroy plan first. ECR repositories are configured with `force_delete = false`; Terraform will not silently delete repositories containing images. Remove images only if they are no longer needed and you explicitly intend to destroy the repositories. Destroying the EC2 instance deletes its root disk because `delete_on_termination` is enabled. Terraform destroy does not delete the local state file automatically.

## Security and costs

- SSH ingress is only TCP 22 from the required single-address `admin_cidr`; never widen it to `0.0.0.0/0`. Refresh the IP before applying and update the rule if it changes.
- Public ingress is limited to TCP 80 and 443. PostgreSQL 5432, API 4000, and Docker-internal services are not exposed.
- Outbound traffic is allowed for operating-system package access and ECR pulls. The EC2 role can pull from the two FoodLoop repositories only (apart from the required `GetAuthorizationToken` action on `*`).
- EC2 metadata requires IMDSv2. The root disk and ECR repositories use encryption. ECR scans on image push and image tags are immutable.
- The instance security group permits HTTP/HTTPS, but Terraform does not configure TLS certificates, a reverse proxy, Docker, application secrets, or deployment. Those are future Ansible/application concerns.
- EC2 runtime, EBS storage, public IPv4, ECR image storage, and internet data transfer may incur charges. Pricing depends on region, usage, and current AWS rates. The design has one instance and one Availability Zone; it is not highly available or a production-grade architecture.
- Local state is not remote, shared, or locked. For this initial academic deployment, protect and back it up securely; do not invent or rely on an S3 backend or DynamoDB lock table.

## Handoff to Ansible

Phase 8 Ansible host configuration is complete per user confirmation. Phase 9 will deploy/update the existing Docker Compose application and handle deployment operations. Use the current EC2 address in the ignored Ansible inventory and `ec2-user` as the SSH user; use the existing local key without copying it into this repository. The current local Docker Compose files are not changed by these Terraform definitions.
