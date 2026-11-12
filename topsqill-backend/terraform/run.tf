# ---------------------------------------------------------------- container registry
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "topsqill"
  format        = "DOCKER"
  description   = "Topsqill.ai API and worker images"
  depends_on    = [google_project_service.apis]
}

# ---------------------------------------------------------------- service account
resource "google_service_account" "app" {
  account_id   = "${local.name}-app"
  display_name = "Topsqill.ai application"
}

# Least privilege: only what the API and workers actually need.
resource "google_project_iam_member" "app_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/redis.viewer",
    "roles/secretmanager.secretAccessor",
    "roles/transcoder.admin",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.app.email}"
}

data "google_project" "this" {
  project_id = var.project_id
}

# Members' ad and WhatsApp tokens are stored as secrets named ads-* and wa-*.
# The app may create those, add versions and delete them, but the condition
# keeps it from changing or deleting any other secret (the database URL, the
# JWT key). Creating a secret is checked against the project itself, hence the
# first clause.
resource "google_project_iam_member" "app_token_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.app.email}"
  condition {
    title       = "member-token-secrets-only"
    description = "Only ads-* and wa-* secrets holding members' platform tokens"
    expression  = <<-EOT
      resource.type == "cloudresourcemanager.googleapis.com/Project" ||
      resource.name.startsWith("projects/${data.google_project.this.number}/secrets/ads-") ||
      resource.name.startsWith("projects/${data.google_project.this.number}/secrets/wa-")
    EOT
  }
}

# Upload links are signed URLs. On Cloud Run there is no key file, so the
# service account signs them through the IAM Credentials API, which needs
# permission to sign as itself. Without it every photo upload failed.
resource "google_service_account_iam_member" "app_sign_self" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app.email}"
}

resource "google_storage_bucket_iam_member" "app_buckets" {
  for_each = { uploads = google_storage_bucket.uploads.name, media = google_storage_bucket.media.name, documents = google_storage_bucket.documents.name }
  bucket   = each.value
  role     = "roles/storage.objectAdmin"
  member   = "serviceAccount:${google_service_account.app.email}"
}

# ---------------------------------------------------------------- secrets
resource "google_secret_manager_secret" "db_url" {
  secret_id = "${local.name}-database-url"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "db_url" {
  secret      = google_secret_manager_secret.db_url.id
  secret_data = "postgres://topsqill:${random_password.db.result}@${google_sql_database_instance.postgres.private_ip_address}:5432/topsqill"
}

resource "random_password" "jwt" {
  length  = 48
  special = false
}
resource "google_secret_manager_secret" "jwt" {
  secret_id = "${local.name}-jwt-secret"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "jwt" {
  secret      = google_secret_manager_secret.jwt.id
  secret_data = random_password.jwt.result
}

# Shared by the API and the web app: lets the web server pass each visitor's IP
# for rate limiting. Give the web app's service the same secret as
# INTERNAL_PROXY_SECRET, or every visitor shares one sign-in rate limit.
resource "random_password" "internal_proxy" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "internal_proxy" {
  secret_id = "${local.name}-internal-proxy-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "internal_proxy" {
  secret      = google_secret_manager_secret.internal_proxy.id
  secret_data = random_password.internal_proxy.result
}

# SMTP password for sign-in code emails. Add its value by hand
# (gcloud secrets versions add ...) before setting smtp_host.
resource "google_secret_manager_secret" "smtp_password" {
  secret_id = "${local.name}-smtp-password"
  replication {
    auto {}
  }
}

# Filled in by hand after `terraform apply`, so keys never sit in the repository.
resource "google_secret_manager_secret" "anthropic" {
  secret_id = "${local.name}-anthropic-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "apish" {
  secret_id = "${local.name}-apish-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "brightdata" {
  secret_id = "${local.name}-brightdata-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "whatsapp" {
  secret_id = "${local.name}-whatsapp-token"
  replication {
    auto {}
  }
}
# Meta app secret: checks that WhatsApp webhooks really come from Meta.
resource "google_secret_manager_secret" "meta_app_secret" {
  secret_id = "${local.name}-meta-app-secret"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "instagram" {
  secret_id = "${local.name}-instagram-app-secret"
  replication {
    auto {}
  }
}

# ---------------------------------------------------------------- API service
resource "google_cloud_run_v2_service" "api" {
  name     = "${local.name}-api"
  location = var.region
  # With a domain, only the load balancer may reach the API. Without one,
  # Cloud Run's own HTTPS URL is the front door.
  deletion_protection = false
  ingress             = var.use_custom_domain ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
  labels              = local.labels

  template {
    service_account = google_service_account.app.email
    # Always-on instances remove cold starts for the first users of the day.
    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }
    max_instance_request_concurrency = 200 # Node handles many requests per container
    timeout                          = "30s"

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/topsqill/api:${var.image_tag}"
      resources {
        limits            = { cpu = "2", memory = "1Gi" }
        cpu_idle          = false # keep the CPU warm so responses stay fast
        startup_cpu_boost = true
      }
      ports { container_port = 8080 }

      env {

        name = "NODE_ENV"

        value = "production"

      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCS_BUCKET_UPLOADS"
        value = google_storage_bucket.uploads.name
      }
      env {
        name  = "GCS_BUCKET_PUBLIC"
        value = google_storage_bucket.media.name
      }
      env {
        # With a domain, media is served through Cloud CDN. Without one, it is
        # read straight from the public bucket.
        name  = "CDN_BASE_URL"
        value = var.use_custom_domain ? "https://${var.cdn_domain}" : "https://storage.googleapis.com/${google_storage_bucket.media.name}"
      }
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
      }
      env {
        name  = "DB_POOL_MAX"
        value = "10"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "INTERNAL_PROXY_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.internal_proxy.secret_id
            version = "latest"
          }
        }
      }
      env {
        # Cloud Run's front end adds one hop; the load balancer adds another.
        name  = "TRUST_PROXY_HOPS"
        value = var.use_custom_domain ? "2" : "1"
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt.secret_id
            version = "latest"
          }
        }
      }
      # Email sign-in, only once SMTP is configured: without these settings the
      # API simply does not offer email sign-in.
      dynamic "env" {
        for_each = var.smtp_host == "" ? {} : {
          SMTP_HOST  = var.smtp_host
          SMTP_PORT  = tostring(var.smtp_port)
          SMTP_USER  = var.smtp_user
          EMAIL_FROM = var.email_from
        }
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.smtp_host == "" ? [] : ["SMTP_PASS"]
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.smtp_password.secret_id
              version = "latest"
            }
          }
        }
      }
      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic.secret_id
            version = "latest"
          }
        }
      }
      # api.sh, only once its key is stored (apish_enabled).
      dynamic "env" {
        for_each = var.apish_enabled ? ["APISH_API_KEY"] : []
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.apish.secret_id
              version = "latest"
            }
          }
        }
      }
      # The API also re-reads this secret every 5 minutes, so api.sh keys
      # (one per line) can be added or changed without a deploy.
      dynamic "env" {
        for_each = var.apish_enabled ? [google_secret_manager_secret.apish.secret_id] : []
        content {
          name  = "APISH_SECRET"
          value = env.value
        }
      }
      # Bright Data, only once its key is stored (brightdata_enabled).
      dynamic "env" {
        for_each = var.brightdata_enabled ? ["BRIGHTDATA_API_KEY"] : []
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.brightdata.secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.brightdata_enabled ? [var.brightdata_zone] : []
        content {
          name  = "BRIGHTDATA_ZONE"
          value = env.value
        }
      }
      env {
        # The website's address: Instagram sends members back to it after they connect.
        name  = "WEB_URL"
        value = var.web_url
      }
      # Topsqill's WhatsApp number: members send their own photos and videos to it
      # (also used for sign-in codes). Only once its token is stored (whatsapp_enabled).
      dynamic "env" {
        for_each = var.whatsapp_enabled ? {
          WHATSAPP_TOKEN  = google_secret_manager_secret.whatsapp.secret_id
          META_APP_SECRET = google_secret_manager_secret.meta_app_secret.secret_id
        } : {}
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.whatsapp_enabled ? {
          WHATSAPP_PHONE_NUMBER_ID = var.whatsapp_phone_number_id
          WHATSAPP_VERIFY_TOKEN    = var.whatsapp_verify_token
        } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      # Members' own Instagram, to pick their posts and reels (instagram_enabled).
      dynamic "env" {
        for_each = var.instagram_enabled ? [var.instagram_app_id] : []
        content {
          name  = "INSTAGRAM_APP_ID"
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.instagram_enabled ? ["INSTAGRAM_APP_SECRET"] : []
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.instagram.secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 5
        period_seconds        = 3
        failure_threshold     = 10
      }
      liveness_probe {
        http_get { path = "/health" }
        period_seconds = 30
      }
    }
  }

  traffic {

    type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"

    percent = 100

  }
}

# ---------------------------------------------------------------- workers
# Background jobs: media, matching, feed delivery, counters. It serves no
# traffic, only a /health endpoint for Cloud Run's probes, so it is internal
# and has no public invoker. One instance always runs with the CPU always on:
# BullMQ pulls jobs from Redis, so a throttled or scaled-to-zero worker would
# simply stop processing.
resource "google_cloud_run_v2_service" "worker" {
  name                = "${local.name}-worker"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  labels              = local.labels

  template {
    service_account = google_service_account.app.email
    scaling {
      min_instance_count = 1
      max_instance_count = var.worker_max_instances
    }
    timeout = "30s"
    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/topsqill/worker:${var.image_tag}"
      resources {
        # The image sets a 1.5 GB Node heap for image processing.
        limits            = { cpu = "2", memory = "2Gi" }
        cpu_idle          = false
        startup_cpu_boost = true
      }
      ports { container_port = 8080 }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCS_BUCKET_UPLOADS"
        value = google_storage_bucket.uploads.name
      }
      env {
        name  = "GCS_BUCKET_PUBLIC"
        value = google_storage_bucket.media.name
      }
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        # Links in alert emails point here.
        name  = "WEB_URL"
        value = var.web_url
      }
      # Alert emails (new message, invitation, lead) go out from the worker.
      dynamic "env" {
        for_each = var.smtp_host == "" ? {} : {
          SMTP_HOST  = var.smtp_host
          SMTP_PORT  = tostring(var.smtp_port)
          SMTP_USER  = var.smtp_user
          EMAIL_FROM = var.email_from
        }
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.smtp_host == "" ? [] : ["SMTP_PASS"]
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.smtp_password.secret_id
              version = "latest"
            }
          }
        }
      }
      env {
        # Not used by the worker, but the shared settings check requires it.
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt.secret_id
            version = "latest"
          }
        }
      }
      env {
        # AI photo tagging (Kitchen, Bedroom…) runs here after each upload.
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic.secret_id
            version = "latest"
          }
        }
      }
      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
      liveness_probe {
        http_get { path = "/health" }
        period_seconds = 30
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [google_secret_manager_secret_version.db_url, google_secret_manager_secret_version.jwt]
}

# Without a load balancer, the API is reached on its own Cloud Run URL, so it
# must accept public requests. Authentication is still enforced by the app.
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count    = var.use_custom_domain ? 0 : 1
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
