-- Landing Page Intelligence (Module 4).

create table if not exists competitor_landing_page_analyses (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  competitor_id varchar(36),
  url varchar(500),
  page_title varchar(300),
  headline text not null,
  subheadline text,
  key_messages jsonb not null default '[]'::jsonb,
  offers jsonb not null default '[]'::jsonb,
  ctas jsonb not null default '[]'::jsonb,
  trust_signals jsonb not null default '[]'::jsonb,
  pricing_mentioned text,
  form_fields jsonb not null default '[]'::jsonb,
  confidence varchar(10) not null,
  source varchar(10) not null default 'claude',
  input_source varchar(10) not null default 'fetched',
  created_at timestamptz not null default now()
);
create index if not exists competitor_landing_page_analyses_owner_idx on competitor_landing_page_analyses (owner_id, created_at desc);
create index if not exists competitor_landing_page_analyses_competitor_idx on competitor_landing_page_analyses (competitor_id, created_at desc);
