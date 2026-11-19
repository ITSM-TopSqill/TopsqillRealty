create table if not exists facebook_accounts (
  owner_id varchar(36) primary key,
  page_id varchar(40) not null,
  page_name varchar(120),
  secret_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
