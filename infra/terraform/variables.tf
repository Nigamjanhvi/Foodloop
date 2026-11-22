variable "aws_region" {
  description = "AWS region for all regional FoodLoop resources."
  type        = string
  default     = "ap-south-1"
}

variable "aws_profile" {
  description = "Shared AWS CLI profile used by Terraform."
  type        = string
  default     = "foodloop-terraform"
}

variable "project_name" {
  description = "Project identifier used in resource names and tags."
  type        = string
  default     = "foodloop"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.project_name))
    error_message = "project_name must be 3-20 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "vpc_cidr" {
  description = "IPv4 address range for the FoodLoop VPC."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "public_subnet_cidr" {
  description = "IPv4 address range for the single public subnet."
  type        = string
  default     = "10.20.1.0/24"

  validation {
    condition     = can(cidrnetmask(var.public_subnet_cidr))
    error_message = "public_subnet_cidr must be a valid IPv4 CIDR block."
  }
}

variable "instance_type" {
  description = "EC2 instance type for the FoodLoop host."
  type        = string
  default     = "t3.small"
}

variable "key_pair_name" {
  description = "Name of the existing EC2 key pair. Terraform does not create or manage the key pair."
  type        = string
  default     = "foodloop-key"
}

variable "admin_cidr" {
  description = "Current administrator public IPv4 address in /32 CIDR notation for SSH access."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.admin_cidr)) && try(split("/", var.admin_cidr)[1] == "32", false)
    error_message = "admin_cidr must be a valid single-address IPv4 CIDR ending in /32. Refresh your public IP before applying."
  }
}

variable "root_volume_size" {
  description = "Encrypted EC2 gp3 root volume size in GiB."
  type        = number
  default     = 30

  validation {
    condition     = var.root_volume_size >= 8 && var.root_volume_size <= 16384 && floor(var.root_volume_size) == var.root_volume_size
    error_message = "root_volume_size must be a whole number between 8 and 16384 GiB."
  }
}

variable "ecr_image_retention_count" {
  description = "Number of most recent tagged images to retain in each ECR repository."
  type        = number
  default     = 10

  validation {
    condition     = var.ecr_image_retention_count >= 1 && var.ecr_image_retention_count <= 1000 && floor(var.ecr_image_retention_count) == var.ecr_image_retention_count
    error_message = "ecr_image_retention_count must be a whole number from 1 to 1000."
  }
}
