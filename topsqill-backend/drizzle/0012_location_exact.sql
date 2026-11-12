-- Whether buyers see the exact spot or only the area ("Approximate area only" on the form).
alter table listings add column if not exists location_exact boolean not null default true;
