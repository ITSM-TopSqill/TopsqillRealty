# Topsqill.ai infrastructure on Google Cloud, Mumbai (asia-south1).
# Run: terraform init && terraform apply
terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.14" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  name   = "topsqill-${var.environment}"
  labels = { app = "topsqill", env = var.environment, managed_by = "terraform" }
}

# ---------------------------------------------------------------- APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com", "sqladmin.googleapis.com", "redis.googleapis.com",
    "compute.googleapis.com", "vpcaccess.googleapis.com", "servicenetworking.googleapis.com",
    "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "secretmanager.googleapis.com",
    "transcoder.googleapis.com", "storage.googleapis.com", "monitoring.googleapis.com", "logging.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# ------------------------------------------------- network (private database)
resource "google_compute_network" "vpc" {
  name                    = "${local.name}-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "subnet" {
  name          = "${local.name}-subnet"
  ip_cidr_range = "10.20.0.0/20"
  region        = var.region
  network       = google_compute_network.vpc.id
}

# Cloud Run reaches Cloud SQL and Memorystore over private IPs only.
resource "google_vpc_access_connector" "connector" {
  name = "${local.name}-vpc-con"
  region = var.region
  # Google requires a /28 of its own for the connector; it must not overlap the
  # main subnet (10.20.0.0/20 covers 10.20.0.0 to 10.20.15.255).
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.20.16.0/28"
  min_instances = 2
  max_instances = 3
  machine_type  = "e2-micro"
}

resource "google_compute_global_address" "private_ip" {
  name          = "${local.name}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

# ---------------------------------------------------------------- database
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "postgres" {
  name                = "${local.name}-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.environment == "prod"
  depends_on          = [google_service_networking_connection.private_vpc]

  settings {
    # Enterprise is the standard edition and accepts db-custom-* tiers.
    # Enterprise Plus only allows the pricier db-perf-optimized-* machines.
    edition           = "ENTERPRISE"
    tier              = var.db_tier
    availability_type = var.environment == "prod" ? "REGIONAL" : "ZONAL" # REGIONAL = automatic failover
    disk_type         = "PD_SSD"
    disk_size         = var.db_disk_gb
    disk_autoresize   = true
    user_labels       = local.labels

    ip_configuration {
      ipv4_enabled    = false # no public IP: the database is unreachable from the internet
      private_network = google_compute_network.vpc.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "19:30" # 01:00 IST, the quietest hour
      point_in_time_recovery_enabled = true    # restore to any second in the last 7 days
      transaction_log_retention_days = 7
      backup_retention_settings { retained_backups = 30 }
      location = "asia-south2" # backups kept in Delhi, a different region
    }

    insights_config {
      query_insights_enabled  = true # shows the slowest queries in the console
      query_string_length     = 1024
      record_application_tags = true
    }

    # Sunday 01:30 IST
    maintenance_window {
      day  = 7
      hour = 20
    }

    # Tuned for many short-lived connections from Cloud Run (through PgBouncer).
    database_flags {
      name = "max_connections"
      value = "400"
    }
    # log anything over 300 ms
    database_flags {
      name = "log_min_duration_statement"
      value = "300"
    }
    database_flags {
      name = "cloudsql.enable_pgaudit"
      value = "on"
    }
  }
}

resource "google_sql_database" "app" {
  name     = "topsqill"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "app" {
  name     = "topsqill"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db.result
}

# Read replica carries heavy read traffic in production.
resource "google_sql_database_instance" "replica" {
  count                = var.environment == "prod" ? 1 : 0
  name                 = "${local.name}-pg-replica"
  database_version     = "POSTGRES_16"
  region               = var.region
  master_instance_name = google_sql_database_instance.postgres.name
  deletion_protection  = false

  replica_configuration { failover_target = false }
  settings {
    tier            = var.db_tier
    disk_type       = "PD_SSD"
    user_labels     = local.labels
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }
  }
}

# ---------------------------------------------------------------- redis
resource "google_redis_instance" "cache" {
  name               = "${local.name}-redis"
  tier               = var.environment == "prod" ? "STANDARD_HA" : "BASIC"
  memory_size_gb     = var.redis_gb
  region             = var.region
  authorized_network = google_compute_network.vpc.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  redis_version      = "REDIS_7_2"
  redis_configs      = { maxmemory-policy = "allkeys-lru" } # evict least-used keys, never refuse writes
  labels             = local.labels
  depends_on         = [google_service_networking_connection.private_vpc]
}

# ---------------------------------------------------------------- storage
resource "google_storage_bucket" "uploads" {
  name                        = "${local.name}-uploads"
  location                    = "ASIA-SOUTH1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  labels                      = local.labels

  cors {
    origin          = var.allowed_origins
    method          = ["PUT", "POST", "GET", "HEAD"]
    response_header = ["Content-Type", "x-goog-resumable"]
    max_age_seconds = 3600
  }
  lifecycle_rule {
    condition { age = 90 }
    # originals get cheaper over time
    action {
      type = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }
  lifecycle_rule {
    condition { age = 365 }
    action {
      type = "SetStorageClass"
      storage_class = "COLDLINE"
    }
  }
  versioning { enabled = true }
}

resource "google_storage_bucket" "media" {
  name                        = "${local.name}-media"
  location                    = "ASIA-SOUTH1"
  uniform_bucket_level_access = true
  labels                      = local.labels
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Range"]
    max_age_seconds = 86400
  }
}

# Media is not made world-readable here: many organisations block "allUsers"
# by policy. Serve it through Cloud CDN once you have a domain, or have the API
# issue short-lived signed URLs.

resource "google_storage_bucket" "documents" {
  name                        = "${local.name}-documents" # KYC, agreements: never public
  location                    = "ASIA-SOUTH1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  labels                      = local.labels
  retention_policy { retention_period = 60 * 60 * 24 * 365 * 3 } # kept 3 years, then removable
}
