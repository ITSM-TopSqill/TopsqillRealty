-- Competitive Audience Strategy (Module 9).

create table if not exists audience_strategies (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  business_id varchar(36) not null,
  competitor_ids jsonb not null default '[]'::jsonb,
  segments jsonb not null,
  decisions jsonb not null default '{}'::jsonb,
  source varchar(10) not null default 'claude',
  created_at timestamptz not null default now()
);
create index if not exists audience_strategies_owner_idx on audience_strategies (owner_id, created_at desc);
