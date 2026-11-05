-- Topsqill.ai initial schema.
create extension if not exists pg_trgm;      -- fuzzy name/locality search
create extension if not exists postgis;      -- "listings within 5 km"
create extension if not exists btree_gin;

create type profile_type as enum ('buyer','seller','dealer','builder');
create type user_status as enum ('pending','active','suspended','removed');
create type listing_status as enum ('draft','pending','active','sold','archived');
create type purpose as enum ('sale','rent');
create type media_kind as enum ('image','video','model3d','document');
create type media_status as enum ('uploading','processing','ready','failed','blocked');
create type connection_status as enum ('pending','accepted','ignored');
create type post_kind as enum ('update','listing','requirement','project','job','insight');

create table users (
  id varchar(36) primary key,
  phone varchar(16) not null,
  email varchar(160),
  name varchar(120) not null,
  type profile_type not null default 'buyer',
  status user_status not null default 'pending',
  is_admin boolean not null default false,
  kyc_verified boolean not null default false,
  rera_number varchar(64),
  rera_verified boolean not null default false,
  city varchar(80),
  localities jsonb not null default '[]'::jsonb,
  headline varchar(160),
  about text,
  agency varchar(160),
  years_experience smallint,
  avatar_media_id varchar(36),
  cover_media_id varchar(36),
  connection_count integer not null default 0,
  follower_count integer not null default 0,
  listing_count integer not null default 0,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_phone_uq on users (phone);
create index users_type_city_idx on users (type, city, created_at desc) where status = 'active';
create index users_name_trgm_idx on users using gin (name gin_trgm_ops);

create table refresh_tokens (
  id varchar(36) primary key,
  user_id varchar(36) not null references users(id) on delete cascade,
  token_hash varchar(64) not null,
  device varchar(160),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index refresh_token_hash_uq on refresh_tokens (token_hash);
create index refresh_user_idx on refresh_tokens (user_id, expires_at);

create table media (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,
  kind media_kind not null,
  status media_status not null default 'uploading',
  object_path text not null,
  mime_type varchar(100) not null,
  bytes bigint,
  width integer,
  height integer,
  duration_ms integer,
  blurhash varchar(64),
  label varchar(60),
  group_name varchar(24),
  caption varchar(200),
  variants jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index media_owner_idx on media (owner_id, created_at desc);
create index media_status_idx on media (status) where status in ('uploading','processing');

create table listings (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,
  status listing_status not null default 'draft',
  title varchar(140) not null,
  purpose purpose not null default 'sale',
  kind varchar(24) not null,
  bhk smallint,
  area_sqft integer,
  price_inr bigint,
  city varchar(80) not null,
  locality varchar(120) not null,
  lat double precision,
  lng double precision,
  possession varchar(32),
  furnishing varchar(32),
  facing varchar(40),
  description text,
  amenities jsonb not null default '[]'::jsonb,
  usps jsonb not null default '[]'::jsonb,
  cover_media_id varchar(36),
  project_id varchar(36),
  rera_number varchar(64),
  verified boolean not null default false,
  view_count integer not null default 0,
  save_count integer not null default 0,
  lead_count integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_search_idx on listings (city, purpose, bhk, price_inr, published_at desc) where status = 'active';
create index listings_locality_idx on listings (locality, purpose, published_at desc) where status = 'active';
create index listings_owner_idx on listings (owner_id, created_at desc);
create index listings_published_idx on listings (published_at desc, id desc) where status = 'active';
-- free-text search across title, locality and description
create index listings_fts_idx on listings using gin (
  to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(locality,'') || ' ' || coalesce(city,'') || ' ' || coalesce(description,''))
) where status = 'active';
-- map searches: "within 5 km of this point"
alter table listings add column geom geography(Point, 4326)
  generated always as (case when lat is not null and lng is not null
    then st_setsrid(st_makepoint(lng, lat), 4326)::geography end) stored;
create index listings_geom_idx on listings using gist (geom) where status = 'active';

create table listing_media (
  listing_id varchar(36) not null references listings(id) on delete cascade,
  media_id varchar(36) not null references media(id) on delete cascade,
  position smallint not null default 0,
  primary key (listing_id, media_id)
);
create index listing_media_idx on listing_media (listing_id, position);

create table connections (
  user_id varchar(36) not null references users(id) on delete cascade,
  peer_id varchar(36) not null references users(id) on delete cascade,
  status connection_status not null default 'pending',
  requested_by varchar(36) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);
create index connections_list_idx on connections (user_id, status, created_at desc);

create table follows (
  follower_id varchar(36) not null references users(id) on delete cascade,
  target_id varchar(36) not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, target_id)
);
create index follows_target_idx on follows (target_id, created_at desc);

create table posts (
  id varchar(36) primary key,
  author_id varchar(36) not null references users(id) on delete cascade,
  kind post_kind not null default 'update',
  body text not null,
  ref_id varchar(36),
  media_ids jsonb not null default '[]'::jsonb,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  repost_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index posts_author_idx on posts (author_id, created_at desc) where hidden = false;
create index posts_recent_idx on posts (created_at desc, id desc) where hidden = false;

create table post_likes (
  post_id varchar(36) not null references posts(id) on delete cascade,
  user_id varchar(36) not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table post_comments (
  id varchar(36) primary key,
  post_id varchar(36) not null references posts(id) on delete cascade,
  author_id varchar(36) not null references users(id) on delete cascade,
  body text not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index post_comments_idx on post_comments (post_id, created_at desc);

create table audit_log (
  id varchar(36) primary key,
  actor_id varchar(36),
  action varchar(60) not null,
  target_type varchar(40),
  target_id varchar(36),
  meta jsonb,
  created_at timestamptz not null default now()
);
create index audit_recent_idx on audit_log (created_at desc);
