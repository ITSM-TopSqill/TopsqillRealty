-- Phase 3: AI listing import, jobs board, ad campaigns.

create type job_status as enum ('draft','open','closed');
create type application_status as enum ('applied','viewed','shortlisted','rejected','hired');
create type campaign_status as enum ('draft','scheduled','active','paused','completed');

create table projects (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,
  source_url text,
  name varchar(160) not null,
  builder varchar(160),
  city varchar(80) not null,
  locality varchar(120) not null,
  rera_number varchar(64),
  status varchar(24) not null default 'Under construction',
  possession varchar(32),
  acres numeric(6,2),
  towers smallint,
  floors smallint,
  units integer,
  open_area smallint,
  payment_plan varchar(40),
  facing jsonb not null default '[]'::jsonb,
  amenities jsonb not null default '[]'::jsonb,
  specs jsonb not null default '[]'::jsonb,
  configs jsonb not null default '[]'::jsonb,       -- [{bhk, sbua, carpet, price, estimated}]
  nearby jsonb not null default '[]'::jsonb,        -- [{name, km, icon}]
  usps jsonb not null default '[]'::jsonb,
  summary text,
  verdict varchar(300),
  risk jsonb,                                        -- {score, level, factors:[]}
  price_estimated boolean not null default false,
  ai_source varchar(16) not null default 'rules',    -- claude | rules
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_idx on projects (owner_id, created_at desc);
create index projects_locality_idx on projects (city, locality) where published = true;

create table project_media (
  project_id varchar(36) not null references projects(id) on delete cascade,
  media_id varchar(36) not null references media(id) on delete cascade,
  position smallint not null default 0,
  primary key (project_id, media_id)
);

alter table listings add column if not exists project_source_id varchar(36) references projects(id) on delete set null;
create index if not exists listings_project_idx on listings (project_source_id);

create table jobs (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,
  company varchar(160) not null,
  title varchar(120) not null,
  category varchar(40) not null,
  employment varchar(24) not null default 'Full-time',
  work_mode varchar(16) not null default 'On-site',
  city varchar(80) not null,
  locality varchar(120),
  openings smallint not null default 1,
  exp_min smallint not null default 0,
  exp_max smallint not null default 5,
  salary_min numeric(6,2),                          -- in lakhs per year
  salary_max numeric(6,2),
  incentives boolean not null default false,
  skills jsonb not null default '[]'::jsonb,
  summary text,
  responsibilities jsonb not null default '[]'::jsonb,
  requirements jsonb not null default '[]'::jsonb,
  status job_status not null default 'open',
  applicant_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index jobs_search_idx on jobs (city, category, created_at desc) where status = 'open';
create index jobs_owner_idx on jobs (owner_id, created_at desc);
create index jobs_fts_idx on jobs using gin (
  to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(company,'') || ' ' || coalesce(city,''))
) where status = 'open';

create table job_applications (
  id varchar(36) primary key,
  job_id varchar(36) not null references jobs(id) on delete cascade,
  user_id varchar(36) not null references users(id) on delete cascade,
  note text,
  phone varchar(16),
  email varchar(160),
  years_experience smallint,
  notice_period varchar(24),
  match_score smallint,
  status application_status not null default 'applied',
  created_at timestamptz not null default now(),
  unique (job_id, user_id)
);
create index job_applications_job_idx on job_applications (job_id, created_at desc);
create index job_applications_user_idx on job_applications (user_id, created_at desc);

create table campaigns (
  id varchar(36) primary key,
  owner_id varchar(36) not null references users(id) on delete cascade,
  listing_id varchar(36) references listings(id) on delete set null,
  project_id varchar(36) references projects(id) on delete set null,
  name varchar(160) not null,
  goal varchar(40) not null default 'Qualified buyers',
  budget_inr bigint not null,
  days smallint not null default 15,
  status campaign_status not null default 'draft',
  plan jsonb,                                        -- personas, pincodes, channels, keywords, qualification
  creatives jsonb,                                   -- headlines, primary texts, carousel, reel script
  forecast jsonb,                                    -- reach, leads, qualified, cost per lead
  spend_inr bigint not null default 0,
  leads_count integer not null default 0,
  qualified_count integer not null default 0,
  launched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_owner_idx on campaigns (owner_id, created_at desc);

create table ai_usage (
  id varchar(36) primary key,
  user_id varchar(36) references users(id) on delete set null,
  feature varchar(40) not null,
  model varchar(60),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  ms integer,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index ai_usage_user_idx on ai_usage (user_id, created_at desc);
create index ai_usage_feature_idx on ai_usage (feature, created_at desc);
