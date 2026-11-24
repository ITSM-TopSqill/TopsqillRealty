-- Lets a campaign target a city and link to a destination without a listing
-- (the "From Creative" and "From Video" campaign flows).
alter table campaigns add column if not exists city varchar(80);
alter table campaigns add column if not exists link text;
