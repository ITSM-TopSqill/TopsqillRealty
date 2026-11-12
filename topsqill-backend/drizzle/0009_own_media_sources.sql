-- Photos and videos come only from the member: their device, Topsqill's
-- WhatsApp number, or their own Instagram. Where each one came from:
alter table media add column if not exists source varchar(16);
create index if not exists media_owner_source_idx on media (owner_id, source, created_at desc);

-- A member's connected Instagram account (the token itself is in Secret Manager).
create table if not exists instagram_accounts (
  owner_id varchar(36) primary key,
  ig_user_id varchar(40) not null,
  username varchar(60),
  secret_ref text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Imported listings no longer link to the source site's video or 3D tour.
update listings set video_url = null, tour_url = null
where source_url is not null and (video_url is not null or tour_url is not null);
