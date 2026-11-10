# Alerts: these are the things worth waking someone up for.
resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" ? 0 : 1
  display_name = "Topsqill.ai alerts"
  type         = "email"
  labels       = { email_address = var.alert_email }
}

locals {
  channels = var.alert_email == "" ? [] : [google_monitoring_notification_channel.email[0].id]
}

resource "google_monitoring_alert_policy" "slow_api" {
  display_name = "${local.name}: API responses slower than 500 ms"
  combiner     = "OR"
  conditions {
    display_name = "95th percentile latency"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.name}-api\" AND metric.type=\"run.googleapis.com/request_latencies\""
      comparison      = "COMPARISON_GT"
      threshold_value = 500
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MEAN"
      }
    }
  }
  notification_channels = local.channels
}

resource "google_monitoring_alert_policy" "errors" {
  display_name = "${local.name}: server errors"
  combiner     = "OR"
  conditions {
    display_name = "5xx responses"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.name}-api\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "180s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
  notification_channels = local.channels
}

resource "google_monitoring_alert_policy" "db_cpu" {
  display_name = "${local.name}: database CPU above 80%"
  combiner     = "OR"
  conditions {
    display_name = "Cloud SQL CPU"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = local.channels
}

resource "google_monitoring_uptime_check_config" "api" {
  count        = var.use_custom_domain ? 1 : 0
  display_name = "${local.name}: API health"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type   = "uptime_url"
    labels = { host = var.api_domain, project_id = var.project_id }
  }
  selected_regions = ["ASIA_PACIFIC", "EUROPE", "USA_OREGON"]
}
