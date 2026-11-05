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
  length = 48
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

# Filled in by hand after `terraform apply`, so keys never sit in the repository.
resource "google_secret_manager_secret" "anthropic" {
  secret_id = "${local.name}-anthropic-key"
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

# ---------------------------------------------------------------- API service
resource "google_cloud_run_v2_service" "api" {
  name     = "${local.name}-api"
  location = var.region
  # With a domain, only the load balancer may reach the API. Without one,
  # Cloud Run's own HTTPS URL is the front door.
  deletion_protection = false
  ingress  = var.use_custom_domain ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
  labels   = local.labels

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
        name = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name = "GCS_BUCKET_UPLOADS"
        value = google_storage_bucket.uploads.name
      }
      env {
        name = "GCS_BUCKET_PUBLIC"
        value = google_storage_bucket.media.name
      }
      env {
        # With a domain, media is served through Cloud CDN. Without one, it is
        # read straight from the public bucket.
        name  = "CDN_BASE_URL"
        value = var.use_custom_domain ? "https://${var.cdn_domain}" : "https://storage.googleapis.com/${google_storage_bucket.media.name}"
      }
      env {
        name = "REDIS_URL"
        value = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
      }
      env {
        name = "DB_POOL_MAX"
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
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt.secret_id
            version = "latest"
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

      startup_probe {
        http_get { path = "/ready" }
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
resource "google_cloud_run_v2_service" "worker" {
  name     = "${local.name}-worker"
  location = var.region
  deletion_protection = false
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  labels   = local.labels

  template {
    service_account = google_service_account.app.email
    scaling {
      min_instance_count = 1 # at least one worker always listening for jobs
      max_instance_count = var.worker_max_instances
    }
    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/topsqill/worker:${var.image_tag}"
      resources {
        limits   = { cpu = "2", memory = "2Gi" } # video and image work needs headroom
        cpu_idle = false
      }
      env {
        name = "NODE_ENV"
        value = "production"
      }
      env {
        name = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name = "GCS_BUCKET_UPLOADS"
        value = google_storage_bucket.uploads.name
      }
      env {
        name = "GCS_BUCKET_PUBLIC"
        value = google_storage_bucket.media.name
      }
      env {
        name = "REDIS_URL"
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
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt.secret_id
            version = "latest"
          }
        }
      }
    }
  }
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
