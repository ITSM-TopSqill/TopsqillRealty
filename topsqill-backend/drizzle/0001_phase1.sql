-- Phase 1: requirements and matching, saved items, moderation and admin.

create type requirement_status as enum ('active','matched','closed');
create type report_status as enum ('open','actioned','dismissed');

create table requirements (
  id varchar(36) primary key,
  user_id varchar(36) not null references users(id) on delete cascade,
  status requirement_status not null default 'active',
  purpose purpose not null default 'sale',
  kind varchar(24) not null default 'Apartment',
  bhk smallint,
  city varchar(80) not null,
  localities jsonb not null default '[]'::jsonb,
  min_price bigint,
  max_price bigint,
  min_area integer,
  timeline varchar(32),
  needs_loan boolean not null default false,
  note text,
  match_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requirements_city_idx on requirements (city, purpose, created_at desc) where status = 'active';
create index requirements_user_idx on requirements (user_id, created_at desc);
-- matching searches localities as a set
create index requirements_loc_idx on requirements using gin (localities jsonb_path_ops) where status = 'active';

create table requirement_matches (
  requirement_id varchar(36) not null references requirements(id) on delete cascade,
  listing_id varchar(36) not null references listings(id) on delete cascade,
  score smallint not null,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (requirement_id, listing_id)
);
create index requirement_matches_idx on requirement_matches (requirement_id, score desc);
create index requirement_matches_listing_idx on requirement_matches (listing_id);

create table saved_items (
  user_id varchar(36) not null references users(id) on delete cascade,
  item_type varchar(16) not null,          -- listing | profile | project | job
  item_id varchar(36) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);
create index saved_items_idx on saved_items (user_id, item_type, created_at desc);

create table reports (
  id varchar(36) primary key,
  reporter_id varchar(36) references users(id) on delete set null,
  target_type varchar(16) not null,        -- post | comment | listing | profile
  target_id varchar(36) not null,
  reason varchar(60) not null,
  detail text,
  status report_status not null default 'open',
  ai_confidence smallint,
  ai_reason varchar(120),
  reviewed_by varchar(36),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_open_idx on reports (status, created_at desc) where status = 'open';
create index reports_target_idx on reports (target_type, target_id);

-- verification requests shown in the admin approvals queue
create table verifications (
  id varchar(36) primary key,
  user_id varchar(36) not null references users(id) on delete cascade,
  kind varchar(16) not null,               -- kyc | rera | builder
  documents jsonb not null default '[]'::jsonb,
  status varchar(16) not null default 'pending',   -- pending | info | approved | rejected
  risk varchar(8),
  risk_score smallint,
  ai_checks jsonb,
  ai_note varchar(300),
  note text,
  reviewed_by varchar(36),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index verifications_queue_idx on verifications (status, created_at) where status in ('pending','info');
create index verifications_user_idx on verifications (user_id, created_at desc);

-- hidden flags used by moderation
alter table listings add column if not exists hidden boolean not null default false;
alter table users add column if not exists suspended_reason varchar(200);

-- search support: trigram indexes for "did you mean" style lookups
create index if not exists listings_title_trgm_idx on listings using gin (title gin_trgm_ops);
create index if not exists listings_locality_trgm_idx on listings using gin (locality gin_trgm_ops);
