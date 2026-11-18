-- Automatic stale-lead reminders: a worker flags any open lead untouched for
-- a few days, drafts the follow-up with AI, and notifies the owner. Sending
-- stays a human action (tap to send), never automatic.
alter table leads add column if not exists followup_draft text;
alter table leads add column if not exists followup_draft_channel varchar(16);
alter table leads add column if not exists followup_reminded_at timestamptz;
