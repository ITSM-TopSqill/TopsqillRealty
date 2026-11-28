-- Competitor Discovery (Module 1) + persisted Creative Analyser (Module 3),
-- and a link from an existing watch to a saved competitor.

create table if not exists competitors (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  name varchar(160) not null,
  website varchar(300),
  category varchar(20) not null default 'direct',
  status varchar(10) not null default 'accepted',
  source varchar(10) not null default 'manual',
  rationale text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists competitors_owner_idx on competitors (owner_id, created_at desc);
create index if not exists competitors_owner_status_idx on competitors (owner_id, status);

alter table competitor_watches add column if not exists competitor_id varchar(36);

create table if not exists competitor_creative_analyses (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  competitor_id varchar(36),
  search_terms varchar(200) not null,
  ad_count integer not null,
  visual_strategy text not null,
  copy_strategy text not null,
  commercial_strategy text not null,
  classification jsonb not null default '[]'::jsonb,
  confidence varchar(10) not null,
  source varchar(10) not null default 'claude',
  created_at timestamptz not null default now()
);
create index if not exists competitor_creative_analyses_owner_idx on competitor_creative_analyses (owner_id, created_at desc);
create index if not exists competitor_creative_analyses_competitor_idx on competitor_creative_analyses (competitor_id, created_at desc);
