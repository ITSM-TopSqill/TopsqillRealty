output "load_balancer_ip" {
  value       = var.use_custom_domain ? google_compute_global_address.lb_ip[0].address : "not used (no custom domain)"
  description = "Point api.topsqill.ai and cdn.topsqill.ai at this A record."
}
output "api_url" { value = google_cloud_run_v2_service.api.uri }
output "database_private_ip" {
  value = google_sql_database_instance.postgres.private_ip_address
  sensitive = true
}
output "redis_host" {
  value = google_redis_instance.cache.host
  sensitive = true
}
output "uploads_bucket" { value = google_storage_bucket.uploads.name }
output "media_bucket" { value = google_storage_bucket.media.name }
output "service_account" { value = google_service_account.app.email }
output "next_steps" {
  value = <<-EOT
    1. Create the DNS A records for ${var.api_domain} and ${var.cdn_domain} pointing at the load balancer IP.
       The managed certificate becomes active 15-60 minutes after DNS resolves.
    2. Add your API keys:
       echo -n "sk-ant-..." | gcloud secrets versions add topsqill-${var.environment}-anthropic-key --data-file=-
       echo -n "EAAG..."    | gcloud secrets versions add topsqill-${var.environment}-whatsapp-token --data-file=-
    3. Build and deploy: gcloud builds submit --config cloudbuild.yaml
    4. Run the migrations once (from Cloud Shell, connected to the VPC): npm run db:migrate
  EOT
}
