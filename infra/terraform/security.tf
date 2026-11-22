resource "aws_security_group" "foodloop" {
  name        = "${var.project_name}-ec2-sg"
  description = "Public web access and administrator-only SSH for FoodLoop EC2."
  vpc_id      = aws_vpc.foodloop.id

  tags = {
    Name = "${var.project_name}-ec2-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.foodloop.id
  description       = "SSH from the current administrator public IP only."
  cidr_ipv4         = var.admin_cidr
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.foodloop.id
  description       = "Public HTTP for the web entrypoint."
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.foodloop.id
  description       = "Public HTTPS for the web entrypoint."
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "internet" {
  security_group_id = aws_security_group.foodloop.id
  description       = "Outbound HTTPS and package access for administration and ECR pulls."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
