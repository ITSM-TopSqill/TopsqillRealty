-- What AI saw in an uploaded walkthrough video: per moment, the room, a short
-- on-screen caption and a narration line. Used by the listing's guided video.
alter table media add column if not exists scenes jsonb;

-- Listings imported from a property portal before imports stopped copying
-- video links still point at the portal's own YouTube videos (with its
-- channel name). Those links are removed; owners can upload their own video.
update listings set video_url = null
where video_url is not null
  and source_url ~* '(^|[./])(99acres|magicbricks|nobroker|housing|squareyards|commonfloor|proptiger|makaan|nestaway|quikr|olx|sulekha|roofandfloor)\.';
