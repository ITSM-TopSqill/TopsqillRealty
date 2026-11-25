-- Continuous Market Learning (Section 11): saved competitor searches the
-- worker re-checks on a schedule, notifying the owner only of genuinely
-- new ads (never re-flagging ones already seen).
alter type notif_kind add value if not exists 'competitor';

create table if not exists competitor_watches (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  search_terms varchar(200) not null,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists competitor_watches_owner_idx on competitor_watches (owner_id, created_at desc);

create table if not exists competitor_watch_ads (
  id varchar(36) primary key,
  watch_id varchar(36) not null,
  fingerprint varchar(64) not null,
  page_name varchar(160),
  headline varchar(200),
  first_seen_at timestamptz not null default now()
);
create unique index if not exists competitor_watch_ads_uq on competitor_watch_ads (watch_id, fingerprint);
create index if not exists competitor_watch_ads_watch_idx on competitor_watch_ads (watch_id);
