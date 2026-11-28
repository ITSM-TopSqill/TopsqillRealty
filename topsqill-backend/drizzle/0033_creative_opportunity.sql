-- Creative Opportunity Generator (Module 7).

create table if not exists creative_concepts (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  market_gap_analysis_id varchar(36),
  opportunity_id varchar(40),
  competitive_strategy_id varchar(36),
  strategy_item_id varchar(40),
  label varchar(200) not null,
  concepts jsonb not null,
  decisions jsonb not null default '{}'::jsonb,
  source varchar(10) not null default 'claude',
  created_at timestamptz not null default now()
);
create index if not exists creative_concepts_owner_idx on creative_concepts (owner_id, created_at desc);
