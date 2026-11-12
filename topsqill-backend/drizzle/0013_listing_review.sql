-- Listings are reviewed by an admin before they go live.
alter type listing_status add value if not exists 'rejected';

-- The latest review, kept on the listing for quick display to the owner.
alter table listings add column if not exists review_decision varchar(16);       -- approved | changes | rejected
alter table listings add column if not exists review_reasons jsonb not null default '[]'::jsonb;
alter table listings add column if not exists review_note text;
alter table listings add column if not exists reviewed_at timestamptz;
alter table listings add column if not exists submitted_at timestamptz;

-- Every submission and decision, for the audit trail.
create table if not exists listing_reviews (
  id varchar(36) primary key,
  listing_id varchar(36) not null,
  owner_id varchar(36) not null,
  status varchar(16) not null default 'pending',                                  -- pending | approved | changes | rejected
  checks jsonb not null default '[]'::jsonb,                                       -- automatic checks at submission
  risk varchar(8),                                                                 -- low | medium | high
  reasons jsonb not null default '[]'::jsonb,
  note text,
  reviewer_id varchar(36),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists listing_reviews_queue_idx on listing_reviews (status, created_at);
create index if not exists listing_reviews_listing_idx on listing_reviews (listing_id, created_at desc);

-- Listings already live stay live: they count as approved.
update listings set review_decision = 'approved', reviewed_at = coalesce(published_at, created_at)
where status in ('active', 'sold', 'archived') and review_decision is null;

-- Alerts about a member's own listing (submitted, approved, changes needed, rejected), emailed straight away.
alter type notif_kind add value if not exists 'listing';
