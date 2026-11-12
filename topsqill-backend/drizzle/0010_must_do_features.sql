-- Price drops: the price before the last cut, and when it was cut (shown as a badge for 30 days).
alter table listings add column if not exists previous_price_inr bigint;
alter table listings add column if not exists price_dropped_at timestamptz;

-- Profile sections: what a member specialises in and is interested in
-- (areas served are the existing "localities").
alter table users add column if not exists specialties jsonb not null default '[]'::jsonb;
alter table users add column if not exists interests jsonb not null default '[]'::jsonb;

-- Who viewed a profile: one row per viewer per day.
create table if not exists profile_views (
  profile_id varchar(36) not null,
  viewer_id varchar(36) not null,
  day date not null default current_date,
  primary key (profile_id, viewer_id, day)
);
create index if not exists profile_views_recent_idx on profile_views (profile_id, day desc);

-- Reposts point at the original post.
alter table posts add column if not exists repost_of_id varchar(36);

-- Listings a dealer offered for a buyer's requirement ("I have a match").
alter table requirement_matches add column if not exists offered_by varchar(36);
