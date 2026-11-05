-- Phase 4: ad platform connections, WhatsApp sending, campaign delivery.

create table ad_accounts (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,
  platform varchar(16) not null,              -- meta | google | linkedin
  account_id varchar(120) not null,           -- the platform's own account id
  account_name varchar(160),
  secret_ref varchar(160),                    -- Secret Manager name; tokens never sit in this table
  status varchar(16) not null default 'connected',  -- connected | needs_reauth | disabled
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index ad_accounts_uq on ad_accounts (owner_id, platform, account_id);
create index ad_accounts_owner_idx on ad_accounts (owner_id, platform);

create table campaign_deliveries (
  id varchar(36) primary key,
  campaign_id varchar(36) not null references campaigns(id) on delete cascade,
  platform varchar(16) not null,
  external_campaign_id varchar(120),
  status varchar(16) not null default 'pending',  -- pending | live | failed | paused
  budget_inr bigint not null,
  error varchar(300),
  stats jsonb not null default '{}'::jsonb,       -- impressions, clicks, spend, leads
  synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index campaign_deliveries_idx on campaign_deliveries (campaign_id);
create index campaign_deliveries_sync_idx on campaign_deliveries (status, synced_at) where status = 'live';

create table whatsapp_accounts (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,
  waba_id varchar(60) not null,
  phone_number_id varchar(60) not null,
  display_number varchar(20),
  secret_ref varchar(160),
  quality_rating varchar(16),
  status varchar(16) not null default 'connected',
  created_at timestamptz not null default now()
);
create unique index whatsapp_accounts_uq on whatsapp_accounts (phone_number_id);
create index whatsapp_accounts_owner_idx on whatsapp_accounts (owner_id);

create table whatsapp_messages (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,
  lead_id varchar(36) references leads(id) on delete set null,
  to_number varchar(16) not null,
  direction varchar(8) not null,              -- out | in
  template varchar(80),
  body text,
  wamid varchar(120),
  status varchar(16) not null default 'queued',  -- queued | sent | delivered | read | failed
  error varchar(300),
  created_at timestamptz not null default now()
);
create unique index whatsapp_messages_wamid_uq on whatsapp_messages (wamid) where wamid is not null;
create index whatsapp_messages_lead_idx on whatsapp_messages (lead_id, created_at desc);
create index whatsapp_messages_owner_idx on whatsapp_messages (owner_id, created_at desc);

-- WhatsApp may only be used where the person agreed to be contacted.
create table whatsapp_optins (
  owner_id varchar(36) not null references users(id) on delete cascade,
  phone varchar(16) not null,
  source varchar(40) not null,                -- lead form | chat | manual
  proof varchar(200),
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner_id, phone)
);
