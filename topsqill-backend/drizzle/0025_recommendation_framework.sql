-- Phase 5 additional requirements, Section 15: restructure recommendations
-- into the fixed observation/evidence/diagnosis/recommendation/impact/
-- confidence/risk/approval shape, with a deterministic priority score.
alter table campaign_recommendations add column if not exists evidence text;
alter table campaign_recommendations add column if not exists diagnosis text;
alter table campaign_recommendations add column if not exists risk text;
alter table campaign_recommendations add column if not exists approval text;
alter table campaign_recommendations add column if not exists priority integer not null default 0;

drop index if exists campaign_recommendations_owner_idx;
create index if not exists campaign_recommendations_owner_idx on campaign_recommendations (owner_id, status, priority desc);
