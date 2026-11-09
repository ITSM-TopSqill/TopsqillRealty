-- Email sign-in and sign-up.
-- Members can now join with an email address instead of a mobile number.

-- Email-only members have no phone. The unique index on phone still holds
-- for everyone who has one (Postgres allows any number of nulls).
alter table users alter column phone drop not null;

-- An address counts for signing in only after the member proved they own it
-- with a code. Unverified addresses (typed into a profile) are never used.
alter table users add column if not exists email_verified boolean not null default false;

-- Each verified address belongs to exactly one account, case-insensitively.
-- This is also the index sign-in by email looks up.
create unique index if not exists users_email_verified_uq on users (lower(email)) where email_verified;
