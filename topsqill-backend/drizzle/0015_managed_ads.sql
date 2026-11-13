-- Managed ads: campaigns run on Topsqill's own Meta and Google ad accounts,
-- paid for from each member's prepaid wallet (topped up through Razorpay).

alter type campaign_status add value if not exists 'review';
alter type campaign_status add value if not exists 'rejected';

-- Money is kept in paise (integers), never in floating point.
create table if not exists wallets (
  owner_id varchar(36) primary key,
  balance_paise bigint not null default 0,      -- available to spend or hold
  held_paise bigint not null default 0,         -- set aside for running campaigns
  updated_at timestamptz not null default now(),
  constraint wallets_non_negative check (balance_paise >= 0 and held_paise >= 0)
);

-- Every change to a wallet, append-only. `ref` makes each change happen once
-- (a payment credited twice, or a spend charged twice, is refused by the index).
create table if not exists wallet_txns (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  kind varchar(16) not null,                    -- topup | hold | release | spend | refund | adjust
  amount_paise bigint not null,                 -- + adds to the balance, - takes from it
  balance_after bigint not null,
  held_after bigint not null,
  campaign_id varchar(36),
  payment_id varchar(36),
  ref varchar(120) not null,
  note varchar(300),
  created_at timestamptz not null default now()
);
create unique index if not exists wallet_txns_ref_uq on wallet_txns (owner_id, ref);
create index if not exists wallet_txns_owner_idx on wallet_txns (owner_id, created_at desc);

-- Razorpay top-ups. The ad credit is `amount_paise`; GST is charged on top.
create table if not exists payments (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  provider varchar(16) not null default 'razorpay',
  order_id varchar(64) not null,
  payment_id varchar(64),
  amount_paise bigint not null,
  gst_paise bigint not null default 0,
  total_paise bigint not null,
  status varchar(16) not null default 'created', -- created | paid | failed
  invoice_no varchar(40),
  billing jsonb not null default '{}'::jsonb,     -- name, GSTIN, address shown on the invoice
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create unique index if not exists payments_order_uq on payments (order_id);
create index if not exists payments_owner_idx on payments (owner_id, created_at desc);
create sequence if not exists invoice_seq;

alter table campaigns add column if not exists platforms jsonb not null default '[]'::jsonb;    -- ["meta","google"]
alter table campaigns add column if not exists media_ids jsonb not null default '[]'::jsonb;    -- photos (and a video) for the ads
alter table campaigns add column if not exists hold_paise bigint not null default 0;           -- set aside from the wallet
alter table campaigns add column if not exists charged_paise bigint not null default 0;        -- spend plus fee, taken so far
alter table campaigns add column if not exists fee_pct numeric(5,2) not null default 0;
alter table campaigns add column if not exists submitted_at timestamptz;
alter table campaigns add column if not exists reviewed_at timestamptz;
alter table campaigns add column if not exists reviewed_by varchar(36);
alter table campaigns add column if not exists review_note text;
alter table campaigns add column if not exists ends_at timestamptz;
alter table campaigns add column if not exists end_reason varchar(40);
alter table campaigns add column if not exists clicks_count integer not null default 0;
alter table campaigns add column if not exists impressions_count bigint not null default 0;

alter table campaign_deliveries add column if not exists external jsonb not null default '{}'::jsonb;  -- ad set, ad, form, budget ids
alter table campaign_deliveries add column if not exists spend_paise bigint not null default 0;
create index if not exists campaign_deliveries_ext_idx on campaign_deliveries (platform, external_campaign_id);

alter table leads add column if not exists campaign_id varchar(36);
create index if not exists leads_campaign_idx on leads (campaign_id) where campaign_id is not null;

alter type notif_kind add value if not exists 'campaign';
