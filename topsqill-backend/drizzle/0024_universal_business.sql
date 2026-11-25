-- Universal Multi-Industry Support: business profiles and their draft
-- marketing plans for non-real-estate businesses. Entirely separate from
-- listings/campaigns (the real-estate ad-launch flow), which this does not touch.
create table if not exists businesses (
  id varchar(36) primary key,
  owner_id varchar(36) not null,
  name varchar(160) not null,
  industry_id varchar(60) not null,
  business_model varchar(120),
  description text,
  products text,
  target_segments text,
  geographic_markets text,
  pricing_notes text,
  revenue_model varchar(120),
  acquisition_goals text,
  sales_cycle varchar(60),
  marketing_budget_inr bigint,
  existing_channels jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists businesses_owner_idx on businesses (owner_id, created_at desc);

create table if not exists generic_campaigns (
  id varchar(36) primary key,
  business_id varchar(36) not null,
  owner_id varchar(36) not null,
  name varchar(160) not null,
  objective varchar(60) not null,
  conversion_event varchar(80) not null,
  budget_inr bigint not null,
  days smallint not null default 15,
  notes text,
  status varchar(16) not null default 'draft',
  created_at timestamptz not null default now()
);
create index if not exists generic_campaigns_business_idx on generic_campaigns (business_id, created_at desc);
