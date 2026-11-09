variable "project_id" {
  type = string
  description = "GCP project, e.g. topsqill-prod"
}
variable "environment" {
  type = string
  default = "prod"
  description = "prod or staging"
}
variable "region" {
  type = string
  default = "asia-south1"
  description = "Mumbai"
}
variable "use_custom_domain" {
  type        = bool
  default     = true
  description = "false deploys without a domain: Cloud Run serves on its own https://*.run.app URL, with no load balancer, no managed certificate and no CDN."
}

variable "api_domain" {
  type = string
  default = "api.topsqill.ai"
}
variable "cdn_domain" {
  type = string
  default = "cdn.topsqill.ai"
}
variable "allowed_origins" {
  type = list(string)
  default = ["https://topsqill.ai", "https://www.topsqill.ai"]
}
variable "db_tier" {
  type = string
  default = "db-custom-4-16384"
  description = "4 vCPU, 16 GB"
}
variable "db_disk_gb" {
  type = number
  default = 100
}
variable "redis_gb" {
  type = number
  default = 5
}
variable "api_min_instances" {
  type = number
  default = 2
}
variable "api_max_instances" {
  type = number
  default = 100
}
variable "worker_max_instances" {
  type = number
  default = 20
}
variable "image_tag" {
  type = string
  default = "latest"
}
variable "alert_email" {
  type = string
  default = ""
}
# Email sign-in codes are sent over SMTP. Leave smtp_host empty to keep email
# sign-in off. Before setting it, add the SMTP password as a version of the
# "<name>-smtp-password" secret that terraform creates.
variable "smtp_host" {
  type    = string
  default = ""
}
variable "smtp_port" {
  type    = number
  default = 587
}
variable "smtp_user" {
  type    = string
  default = ""
}
variable "email_from" {
  type        = string
  default     = ""
  description = "Sender, e.g. \"Topsqill.ai <no-reply@topsqill.ai>\""
}
