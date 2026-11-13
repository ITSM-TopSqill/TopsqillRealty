-- Safety and account: blocking members, choosing alerts, deleting the account.

create table if not exists user_blocks (
  blocker_id varchar(36) not null,
  blocked_id varchar(36) not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index if not exists user_blocks_blocked_idx on user_blocks (blocked_id);

-- Which alerts reach the member by email and by push: { "email": { "message": false }, "push": { ... } }.
-- A kind that is not listed is on.
alter table users add column if not exists alert_prefs jsonb not null default '{}'::jsonb;
alter table users add column if not exists deleted_at timestamptz;

-- One open report per member per item, so repeated taps don't flood the admin queue.
create unique index if not exists reports_reporter_target_uq on reports (reporter_id, target_type, target_id) where status = 'open' and reporter_id is not null;
