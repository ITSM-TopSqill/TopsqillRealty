-- Universal Customer Differentiator Engine, Workstream 2: saved CRM
-- segments (AND/OR/NOT conditions over real lead fields). Not pushed to
-- any ad platform - no Custom Audience integration exists yet.
create table if not exists customer_segments (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  name varchar(160) not null,
  definition jsonb not null,
  source varchar(16) not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_segments_owner_idx on customer_segments (owner_id, created_at desc);
