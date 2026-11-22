output "vpc_id" {
  description = "FoodLoop VPC ID."
  value       = aws_vpc.foodloop.id
}

output "public_subnet_id" {
  description = "FoodLoop public subnet ID."
  value       = aws_subnet.public.id
}

output "internet_gateway_id" {
  description = "FoodLoop Internet Gateway ID."
  value       = aws_internet_gateway.foodloop.id
}

output "route_table_id" {
  description = "FoodLoop public route table ID."
  value       = aws_route_table.public.id
}

output "security_group_id" {
  description = "FoodLoop EC2 security group ID."
  value       = aws_security_group.foodloop.id
}

output "ec2_instance_id" {
  description = "FoodLoop EC2 instance ID."
  value       = aws_instance.foodloop.id
}

output "ec2_public_ip" {
  description = "Public IPv4 address of the FoodLoop EC2 instance."
  value       = aws_instance.foodloop.public_ip
}

output "ec2_public_dns" {
  description = "Public DNS name of the FoodLoop EC2 instance."
  value       = aws_instance.foodloop.public_dns
}

output "ec2_availability_zone" {
  description = "Availability Zone selected for the FoodLoop subnet and instance."
  value       = aws_instance.foodloop.availability_zone
}

output "ec2_iam_role_name" {
  description = "IAM role attached to the EC2 instance."
  value       = aws_iam_role.ec2.name
}

output "ec2_instance_profile_name" {
  description = "Instance profile attached to the EC2 instance."
  value       = aws_iam_instance_profile.ec2.name
}

output "frontend_ecr_repository_url" {
  description = "ECR URL for the frontend image."
  value       = aws_ecr_repository.foodloop["foodloop-frontend"].repository_url
}

output "backend_ecr_repository_url" {
  description = "ECR URL for backend and worker images."
  value       = aws_ecr_repository.foodloop["foodloop-backend"].repository_url
}

output "ecr_registry_id" {
  description = "AWS account ID that owns the FoodLoop ECR repositories."
  value       = aws_ecr_repository.foodloop["foodloop-frontend"].registry_id
}

output "ec2_ssh_user" {
  description = "SSH login name for Amazon Linux 2023."
  value       = "ec2-user"
}
