-- Ad Library search only ever covers the UK/EU (and worldwide political ads) -
-- for every other market (India included) the only honest option is to type
-- in a competitor's ad text by hand and still run the same creative analysis.
alter table competitor_creative_analyses add column if not exists input_source varchar(10) not null default 'meta_api';
