-- Extra localities a campaign targets beyond its primary point, and areas to exclude.
-- Each entry: { label, lat, lng, radiusKm }.
alter table campaigns add column if not exists extra_places jsonb;
alter table campaigns add column if not exists exclude_places jsonb;
