-- Platform settings an admin can change without a deploy (AI on/off per feature, model).
create table if not exists app_settings (
  key varchar(40) primary key,
  value jsonb not null,
  updated_by varchar(36),
  updated_at timestamptz not null default now()
);

-- "Become a channel partner" requests reach the builder as leads.
alter type lead_source add value if not exists 'channel_partner';
