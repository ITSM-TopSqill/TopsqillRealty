-- Phase 5: AI campaign insights, alerts, and recommendations, each requiring
-- explicit approval before anything changes on a live campaign (Phase 4's
-- already-automatic opt-in budget shifting is the one exception).
create table if not exists campaign_recommendations (
  id varchar(36) primary key,
  campaign_id varchar(36) not null,
  owner_id varchar(36) not null,
  kind varchar(16) not null,                 -- 'alert' | 'suggestion'
  category varchar(40) not null,              -- e.g. 'cost_rising', 'spend_no_leads', 'locality_low_perf'
  title varchar(160) not null,
  why text not null,
  impact text not null,
  confidence varchar(10) not null,            -- 'low' | 'medium' | 'high'
  action text,
  payload jsonb not null default '{}'::jsonb,
  status varchar(16) not null default 'pending',  -- 'pending' | 'approved' | 'rejected' | 'dismissed'
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists campaign_recommendations_campaign_idx on campaign_recommendations (campaign_id, created_at desc);
create index if not exists campaign_recommendations_owner_idx on campaign_recommendations (owner_id, status, created_at desc);
