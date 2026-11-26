-- Formal A/B Experiment Engine (Section 13): track which version was
-- applied, so the outcome comparison can carry a real hypothesis instead
-- of a generic label.
alter table campaign_evolutions add column if not exists applied_version_id varchar(36);
