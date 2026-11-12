-- Listings, requirements and jobs now appear on the wall as a post by their
-- owner. Give the ones already live from the last 60 days their post, dated
-- when they went live, so the wall isn't empty of them. Run once; new ones
-- get their post when they go live.
insert into posts (id, author_id, kind, body, ref_id, media_ids, created_at)
select gen_random_uuid()::text, l.owner_id, 'listing',
       '🏠 Just listed' || case when l.purpose = 'rent' then ' for rent' else '' end || ': '
         || coalesce(l.bhk::text || ' BHK ', '') || l.kind || ' in ' || l.locality || ', ' || l.city || E'\n' || l.title,
       l.id,
       case when l.cover_media_id is not null then jsonb_build_array(l.cover_media_id) else '[]'::jsonb end,
       coalesce(l.published_at, l.created_at)
from listings l
where l.status = 'active' and l.hidden = false
  and coalesce(l.published_at, l.created_at) > now() - interval '60 days'
  and not exists (select 1 from posts p where p.kind = 'listing' and p.ref_id = l.id);

insert into posts (id, author_id, kind, body, ref_id, created_at)
select gen_random_uuid()::text, r.user_id, 'requirement',
       '🔎 Looking to ' || case when r.purpose = 'rent' then 'rent' else 'buy' end || ': '
         || coalesce(r.bhk::text || ' BHK ', '') || r.kind || ' in '
         || case when jsonb_array_length(r.localities) > 0
                 then (select string_agg(x, ' / ') from (select jsonb_array_elements_text(r.localities) x limit 3) t) || ', ' || r.city
                 else r.city end
         || E'\nHave a match? Reply here or send it from your listings.',
       r.id, r.created_at
from requirements r
where r.status = 'active' and r.created_at > now() - interval '60 days'
  and not exists (select 1 from posts p where p.kind = 'requirement' and p.ref_id = r.id);

insert into posts (id, author_id, kind, body, ref_id, created_at)
select gen_random_uuid()::text, j.owner_id, 'job',
       '💼 Hiring: ' || j.title || ' at ' || j.company || ', ' || coalesce(j.locality || ', ', '') || j.city,
       j.id, j.created_at
from jobs j
where j.status = 'open' and j.created_at > now() - interval '60 days'
  and not exists (select 1 from posts p where p.kind = 'job' and p.ref_id = j.id);
