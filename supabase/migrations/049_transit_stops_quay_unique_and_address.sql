-- Real bug: user_transit_stops_unique was UNIQUE(user_id, stop_id) only — even
-- though the table has carried quay_id/quay_description since migration 022,
-- the uniqueness never included it. That made it IMPOSSIBLE to save the same
-- physical stop under two different directions (e.g. "Home" = platform toward
-- downtown vs a second favorite = the same stop's platform toward the gym) —
-- the second insert always hit "duplicate key value violates unique
-- constraint" with no graceful path, which is exactly the raw DB error the
-- user hit. Fix: make the uniqueness (user_id, stop_id, quay_id) so distinct
-- quays of the same stop are distinct favorites. quay_id is nullable ("all
-- quays"/whole-stop saves use NULL) and Postgres treats NULL as always
-- distinct in a plain unique index, which would silently let "all quays" be
-- saved twice for the same stop — so this uses an expression index that
-- coalesces NULL to '' to actually enforce one "all quays" save per stop too.
drop index if exists user_transit_stops_unique;
create unique index user_transit_stops_unique
  on user_transit_stops (user_id, stop_id, coalesce(quay_id, ''));

-- Address favorites: a saved "stop" can now also be a plain address/POI (e.g.
-- a home/work address with no NSR stop id and no live departures) — needed
-- for the new "save an address as a favorite" flow. Nullable: only populated
-- for address-type favorites; NSR stop favorites keep these null (their
-- coordinates aren't needed since departures/quay data come from the stop id).
alter table user_transit_stops
  add column if not exists lat double precision,
  add column if not exists lon double precision;
