-- Phase 2: messaging, notifications, leads and CRM, lead sources.

create type lead_stage as enum ('new','contacted','site_visit','negotiation','booked','lost');
create type lead_source as enum ('website','meta','google','linkedin','whatsapp','portal_99acres','portal_magicbricks','portal_housing','call','topsqill','manual','other');
create type notif_kind as enum ('connection','message','lead','match','post','comment','system','job');

/* ------------------------------- messaging ------------------------------- */
create table conversations (
  id varchar(36) primary key,
  a_id varchar(36) not null references users(id) on delete cascade,   -- always the smaller id
  b_id varchar(36) not null references users(id) on delete cascade,
  last_message_at timestamptz,
  last_message_preview varchar(160),
  last_sender_id varchar(36),
  created_at timestamptz not null default now(),
  constraint conversations_pair_uq unique (a_id, b_id)
);
create index conversations_a_idx on conversations (a_id, last_message_at desc);
create index conversations_b_idx on conversations (b_id, last_message_at desc);

create table messages (
  id varchar(36) primary key,
  conversation_id varchar(36) not null references conversations(id) on delete cascade,
  sender_id varchar(36) not null references users(id) on delete cascade,
  body text,
  media_ids jsonb not null default '[]'::jsonb,
  ref_type varchar(16),                       -- listing | requirement | job shared in chat
  ref_id varchar(36),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
-- the only query that matters: newest messages in a conversation
create index messages_convo_idx on messages (conversation_id, created_at desc, id desc);
create index messages_unread_idx on messages (conversation_id, sender_id) where read_at is null;

/* ----------------------------- notifications ----------------------------- */
create table notifications (
  id varchar(36) primary key,
  user_id varchar(36) not null references users(id) on delete cascade,
  kind notif_kind not null,
  title varchar(160) not null,
  body varchar(300),
  actor_id varchar(36),
  target_type varchar(16),
  target_id varchar(36),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

create table push_tokens (
  token varchar(255) primary key,
  user_id varchar(36) not null references users(id) on delete cascade,
  platform varchar(12) not null,              -- web | android | ios
  created_at timestamptz not null default now()
);
create index push_tokens_user_idx on push_tokens (user_id);

/* -------------------------------- leads & CRM -------------------------------- */
create table leads (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,   -- the dealer or builder
  assignee_id varchar(36) references users(id) on delete set null,
  name varchar(120) not null,
  phone varchar(16),
  email varchar(160),
  source lead_source not null default 'other',
  source_detail varchar(120),                 -- campaign or form name
  listing_id varchar(36) references listings(id) on delete set null,
  requirement_id varchar(36),
  stage lead_stage not null default 'new',
  score smallint not null default 50,
  score_reason varchar(200),
  budget_min bigint,
  budget_max bigint,
  city varchar(80),
  locality varchar(120),
  note text,
  qualified boolean not null default false,
  otp_verified boolean not null default false,
  external_id varchar(120),                   -- the platform's own id, used to avoid duplicates
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- the CRM board: one index serves "my leads by stage, newest first"
create index leads_board_idx on leads (owner_id, stage, created_at desc);
create index leads_assignee_idx on leads (assignee_id, stage, created_at desc);
create index leads_phone_idx on leads (owner_id, phone);
create unique index leads_external_uq on leads (source, external_id) where external_id is not null;
create index leads_listing_idx on leads (listing_id);

create table lead_activities (
  id varchar(36) primary key,
  lead_id varchar(36) not null references leads(id) on delete cascade,
  actor_id varchar(36),
  kind varchar(24) not null,                  -- note | call | whatsapp | email | stage | visit | system
  body text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index lead_activities_idx on lead_activities (lead_id, created_at desc);

create table lead_sources (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,
  source lead_source not null,
  name varchar(80) not null,
  config jsonb not null default '{}'::jsonb,  -- credentials live in Secret Manager, not here
  ingest_key varchar(48) not null,            -- the secret in the webhook URL
  enabled boolean not null default true,
  assign_rule varchar(24) not null default 'owner',  -- owner | round_robin | locality
  last_event_at timestamptz,
  lead_count integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index lead_sources_key_uq on lead_sources (ingest_key);
create index lead_sources_owner_idx on lead_sources (owner_id, source);

create table ingest_events (
  id varchar(36) primary key,
  source_id varchar(36) references lead_sources(id) on delete cascade,
  status varchar(16) not null,                -- received | created | duplicate | failed
  payload jsonb,
  lead_id varchar(36),
  error varchar(300),
  created_at timestamptz not null default now()
);
create index ingest_events_idx on ingest_events (source_id, created_at desc);
