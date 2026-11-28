-- Competitive Growth Intelligence, Module 10: a generic-campaign draft can
-- now carry a snapshot of the approved creative concept it was created
-- from, plus traceability back to that concept batch/item.
alter table generic_campaigns add column if not exists creative jsonb;
alter table generic_campaigns add column if not exists source_concept_batch_id varchar(36);
alter table generic_campaigns add column if not exists source_concept_id varchar(40);
