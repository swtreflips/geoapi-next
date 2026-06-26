-- Reference only — the `geocode_cache` table already exists in the rates Supabase
-- project (same columns as the schedules project). Run this only on a fresh project.
-- Requires the postgis extension to be enabled.

create table if not exists geocode_cache (
  query        text primary key,
  latitude     double precision not null,
  longitude    double precision not null,
  display_name text,
  geom         geography(Point, 4326),
  provider     text not null,
  created_at   timestamptz default now()
);

create or replace function geocode_cache_set_geom()
returns trigger as $$
begin
  new.geom := st_setsrid(
    st_makepoint(new.longitude, new.latitude),
    4326
  )::geography;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_geocode_cache_set_geom on geocode_cache;

create trigger trg_geocode_cache_set_geom
before insert or update of latitude, longitude on geocode_cache
for each row execute function geocode_cache_set_geom();

create index if not exists geocode_cache_geom_idx
  on geocode_cache using gist (geom);
