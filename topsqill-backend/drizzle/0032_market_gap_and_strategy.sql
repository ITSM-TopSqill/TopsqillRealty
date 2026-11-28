-- Competitive Market Gap Engine (Module 5) and Strategy Generator (Module 6).

create table if not exists market_gap_analyses (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  business_id varchar(36),
  competitor_ids jsonb not null default '[]'::jsonb,
  opportunities jsonb not null,
  decisions jsonb not null default '{}'::jsonb,
  source varchar(10) not null default 'claude',
  created_at timestamptz not null default now()
);
create index if not exists market_gap_analyses_owner_idx on market_gap_analyses (owner_id, created_at desc);

create table if not exists competitive_strategies (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  business_id varchar(36),
  competitor_ids jsonb not null default '[]'::jsonb,
  market_gap_analysis_id varchar(36),
  strategies jsonb not null,
  decisions jsonb not null default '{}'::jsonb,
  source varchar(10) not null default 'claude',
  created_at timestamptz not null default now()
);
create index if not exists competitive_strategies_owner_idx on competitive_strategies (owner_id, created_at desc);
