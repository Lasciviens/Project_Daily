-- Add quay targeting to saved transit stops
alter table user_transit_stops
  add column if not exists quay_id text,
  add column if not exists quay_description text;
