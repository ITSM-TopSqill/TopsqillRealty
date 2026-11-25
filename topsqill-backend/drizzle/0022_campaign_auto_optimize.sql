-- Phase 4: opt-in autonomous budget shifting between Meta and Google for a
-- running campaign, based on which platform's cost per qualified lead is lower.
alter table campaigns add column if not exists auto_optimize boolean not null default false;
alter table campaigns add column if not exists optimized_at timestamptz;
alter table campaigns add column if not exists optimize_note text;
-- The daily budget actually set on each platform right now (distinct from
-- campaign_deliveries.budget_inr, which is that platform's TOTAL share of the
-- campaign budget) - needed so reallocation has a number to shift from/to.
alter table campaign_deliveries add column if not exists daily_budget_paise bigint;
