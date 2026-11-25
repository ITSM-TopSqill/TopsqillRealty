-- AI Campaign Evolution (first-party slice): proposed redesign versions for
-- an existing campaign. Never applied to the live campaign directly -
-- approved changes become a new draft campaign via the normal launch flow.
create table if not exists campaign_evolutions (
  id varchar(36) primary key,
  campaign_id varchar(36) not null,
  owner_id varchar(36) not null,
  source varchar(16) not null default 'rules',
  versions jsonb not null,
  decisions jsonb not null default '{}'::jsonb,
  status varchar(16) not null default 'proposed',
  applied_campaign_id varchar(36),
  created_at timestamptz not null default now()
);
create index if not exists campaign_evolutions_campaign_idx on campaign_evolutions (campaign_id, created_at desc);
