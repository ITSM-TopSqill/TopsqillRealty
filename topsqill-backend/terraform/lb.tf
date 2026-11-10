# HTTPS load balancer with a managed certificate, Cloud CDN and Cloud Armor.
resource "google_compute_region_network_endpoint_group" "api_neg" {
  count                 = var.use_custom_domain ? 1 : 0
  name                  = "${local.name}-api-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  cloud_run { service = google_cloud_run_v2_service.api.name }
}

resource "google_compute_backend_service" "api" {
  count                 = var.use_custom_domain ? 1 : 0
  name                  = "${local.name}-api-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  enable_cdn            = true
  security_policy       = google_compute_security_policy.armor[0].id

  backend { group = google_compute_region_network_endpoint_group.api_neg[0].id }

  # The CDN honours the cache-control headers the API sets, so public search
  # results are served from the edge and never reach the database twice.
  cdn_policy {
    cache_mode                   = "USE_ORIGIN_HEADERS"
    negative_caching             = true
    serve_while_stale            = 86400
    signed_url_cache_max_age_sec = 0
    cache_key_policy {
      include_host         = true
      include_protocol     = true
      include_query_string = true
    }
  }
  log_config {
    enable      = true
    sample_rate = 0.1
  }
}

resource "google_compute_backend_bucket" "media" {
  count       = var.use_custom_domain ? 1 : 0
  name        = "${local.name}-media-backend"
  bucket_name = google_storage_bucket.media.name
  enable_cdn  = true
  cdn_policy {
    cache_mode        = "CACHE_ALL_STATIC"
    default_ttl       = 31536000 # media never changes once written
    max_ttl           = 31536000
    client_ttl        = 31536000
    negative_caching  = true
    serve_while_stale = 86400
  }
}

resource "google_compute_url_map" "main" {
  count           = var.use_custom_domain ? 1 : 0
  name            = "${local.name}-urlmap"
  default_service = google_compute_backend_service.api[0].id

  host_rule {

    hosts = [var.cdn_domain]

    path_matcher = "media"

  }
  path_matcher {
    name            = "media"
    default_service = google_compute_backend_bucket.media[0].id
  }
}

resource "google_compute_managed_ssl_certificate" "cert" {
  count = var.use_custom_domain ? 1 : 0
  name  = "${local.name}-cert"
  managed { domains = [var.api_domain, var.cdn_domain] }
}

resource "google_compute_target_https_proxy" "https" {
  count            = var.use_custom_domain ? 1 : 0
  name             = "${local.name}-https-proxy"
  url_map          = google_compute_url_map.main[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.cert[0].id]
  # HTTP/3 makes a real difference on mobile networks.
  quic_override = "ENABLE"
}

resource "google_compute_global_address" "lb_ip" {
  count = var.use_custom_domain ? 1 : 0
  name  = "${local.name}-lb-ip"
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = var.use_custom_domain ? 1 : 0
  name                  = "${local.name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.https[0].id
  ip_address            = google_compute_global_address.lb_ip[0].id
}

# Plain HTTP is redirected to HTTPS.
resource "google_compute_url_map" "redirect" {
  count = var.use_custom_domain ? 1 : 0
  name  = "${local.name}-redirect"
  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}
resource "google_compute_target_http_proxy" "http" {
  count   = var.use_custom_domain ? 1 : 0
  name    = "${local.name}-http-proxy"
  url_map = google_compute_url_map.redirect[0].id
}
resource "google_compute_global_forwarding_rule" "http" {
  count                 = var.use_custom_domain ? 1 : 0
  name                  = "${local.name}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.http[0].id
  ip_address            = google_compute_global_address.lb_ip[0].id
}

# Blocks common attacks and limits abusive clients before they reach the API.
resource "google_compute_security_policy" "armor" {
  count = var.use_custom_domain ? 1 : 0
  name  = "${local.name}-armor"

  rule {
    action   = "rate_based_ban"
    priority = 1000
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 600
        interval_sec = 60
      }
      ban_duration_sec = 300
    }
    description = "600 requests per minute per IP"
  }

  rule {
    action   = "deny(403)"
    priority = 900
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-v33-stable') || evaluatePreconfiguredExpr('xss-v33-stable')"
      }
    }
    description = "Block SQL injection and cross-site scripting attempts"
  }

  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    description = "Default allow"
  }
}
