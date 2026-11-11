-- Imported and richer listings: a walkthrough video, a 3D tour, and the page
-- the listing was imported from (kept for the owner and for moderation).
alter table listings add column if not exists video_url text;
alter table listings add column if not exists tour_url text;
alter table listings add column if not exists source_url text;
