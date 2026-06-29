# SUPA.md — Supabase / PostGIS setup for geoapi-next

Everything SQL-side that makes this app work, against the **rates** Supabase project.
The app (`/api/geocode`, `/api/within`) talks to two tables — `geocode_cache` and
`us_ports` — both of which need a real PostGIS **geography** column, an index, and a
trigger. This file is the source of truth for that setup (there are no migration files).

---

## 0. Prerequisite

PostGIS must be enabled:
```sql
create extension if not exists postgis;
```

---

## 1. The core lesson: type ≠ value (why this was fiddly)

Three things tripped us up; keep them in mind:

1. **A column's declared TYPE governs storage + indexing — a trigger only sets the VALUE.**
   Both tables originally had `geom` as **`text`**. A trigger wrote a geometry into it, but
   Postgres coerced the geometry to a **string** (hex EWKB). It *looked* spatial but was text,
   so a GiST index failed (`data type text has no default operator class for "gist"`) and
   `ST_DWithin` couldn't use it. Fix = change the **column type**, not just the trigger.
2. **`geometry` vs `geography`.** `ST_SetSRID(ST_MakePoint(...),4326)` returns **geometry**
   (distances in degrees). We want **geography** (distances in **meters**). Cast with
   `::geography`. (geometry → geography is an implicit cast, so assigning into a geography
   column also works, but we cast explicitly for clarity.)
3. **`ST_MakePoint` takes longitude FIRST:** `ST_MakePoint(lon, lat)`. Easy to flip.

Data-type transformation used throughout:
```
double precision lat/lon  →  ST_MakePoint(lon, lat)  →  ST_SetSRID(…, 4326)  →  ::geography
text (hex EWKB)           →  ::geometry  →  ::geography      (parse-then-cast, if converting in place)
miles                     →  miles * 1609.344  (meters, for ST_DWithin on geography)
```

---

## 2. `geocode_cache`

Written by the app on every geocode (upsert by `query`); `geom` set by trigger.

**Fixes applied (table pre-existed, created by hand):**
```sql
-- (a) the upsert target — onConflict:'query' needs a unique/PK on query
alter table public.geocode_cache
  add constraint geocode_cache_query_key unique (query);

-- (b) geom was text → convert to geography, recomputing from lat/lon (robust backfill)
alter table public.geocode_cache
  alter column geom type geography(Point, 4326)
  using st_setsrid(st_makepoint(longitude, latitude), 4326)::geography;

-- (c) spatial index
create index if not exists geocode_cache_geom_idx
  on public.geocode_cache using gist (geom);
analyze public.geocode_cache;
```

**Final shape (for reference / fresh setup):**
```sql
create table if not exists geocode_cache (
  query        text primary key,            -- normalized: trim+lower+collapse spaces
  latitude     double precision not null,
  longitude    double precision not null,
  display_name text,
  geom         geography(Point, 4326),      -- set by trigger
  provider     text not null,
  created_at   timestamptz default now()
);
```

---

## 3. `us_ports`

Static reference table of US ports; `geom` used for proximity-to-port checks.

**Fixes applied (geom was text):**
```sql
-- add a real geography column, populate from lat/lon, index it
alter table us_ports add column geog geography(Point, 4326);
update us_ports
  set geog = st_setsrid(st_makepoint(longitude::double precision, latitude::double precision), 4326)::geography;
create index us_ports_geog_idx on us_ports using gist (geog);
analyze us_ports;

-- drop the old text geom, then rename geog → geom (so both tables use the same column name)
alter table us_ports drop column geom;            -- old text column
alter table us_ports rename column geog to geom;
alter index us_ports_geog_idx rename to us_ports_geom_idx;   -- cosmetic
```

Result: `us_ports.geom` is `geography(Point,4326)`, GiST-indexed, same name as `geocode_cache.geom`.

---

## 4. Shared trigger — keeps `geom` populated on write

One function, attached to **both** tables. Note the `::geography` cast (the original version
omitted it, which is the bug that produced geometry/text).

```sql
create or replace function set_geom()
returns trigger language plpgsql as $$
begin
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  return NEW;
end;
$$;

-- triggers (already attached; recreate on a fresh project)
create trigger trg_set_geom before insert or update on public.geocode_cache
  for each row execute function set_geom();
create trigger trg_set_geom before insert or update on public.us_ports
  for each row execute function set_geom();
```
`create or replace function` updates it in place — existing `trg_set_geom` triggers keep pointing at it.

---

## 5. Distance function — `cache_within_miles`

Used by `/api/within` via `supabase.rpc('cache_within_miles', { a, b, miles })`.
`ST_DWithin` on two cached geography points; miles → meters. `SECURITY DEFINER` so it works
regardless of which key the server uses (bypasses RLS on `geocode_cache`).

```sql
create or replace function cache_within_miles(a text, b text, miles double precision default 100)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select st_dwithin(ca.geom, cb.geom, miles * 1609.344)
  from geocode_cache ca, geocode_cache cb
  where ca.query = a and cb.query = b;
$$;
```
- Args `a`/`b` are the **normalized** cache keys (lowercased/trimmed), which is what the app passes.
- Returns `null` only if a key isn't cached; the API geocodes both first, so it returns a real boolean.
- Sanity: `select cache_within_miles('los angeles, ca','santa monica, ca', 100);` → `true`.

### Companion (not used yet) — location vs nearest US port
The real rates feature ("is this within X mi of any port"). Kept here for when it's wired:
```sql
create or replace function is_near_port(p_query text, p_meters double precision default 80467) -- ~50 mi
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from us_ports p, geocode_cache c
    where c.query = p_query and st_dwithin(p.geom, c.geom, p_meters)
  );
$$;
```

---

## 5b. `drayage_routes` — HERE truck-route cache

Written by the app (`/api/route`) on every new origin→destination pair; the two `geom`
columns are set by a trigger. Same philosophy as `geocode_cache`: cache so each pair only
ever hits HERE once. The cache key is the **(origin, destination) pair of normalized city
keys** (same `normalize` as `geocode_cache.query`) — directional, so A→B and B→A are
separate rows. Durations are **traffic-typical** (the app sends no `departureTime`), so cached
values stay meaningful indefinitely.

> HERE units gotcha (mirrors the lon-first / geography lessons above): HERE v8 truck
> dimensions are in **centimeters**, weight in **kilograms** — `summary.length` is **meters**,
> `summary.duration` is **seconds**. The `polyline` is HERE *flexible polyline* (not WKB) — it
> stays `text` and is decoded client-side; do **not** try to cast it to geometry.

**Fresh setup:**
```sql
create table if not exists public.drayage_routes (
  origin_query        text not null,              -- normalized origin city key
  destination_query   text not null,              -- normalized destination city key
  origin_lat          double precision not null,
  origin_lon          double precision not null,
  dest_lat            double precision not null,
  dest_lon            double precision not null,
  distance_m          double precision not null,  -- summary.length (meters)
  duration_s          integer not null,           -- summary.duration (seconds)
  base_duration_s     integer,                    -- summary.baseDuration (free-flow)
  typical_duration_s  integer,                    -- summary.typicalDuration (primary ETA)
  polyline            text not null,              -- HERE flexible polyline (decode client-side)
  transport_mode      text not null default 'truck',
  provider            text not null default 'here',
  origin_geom         geography(Point, 4326),     -- set by trigger
  dest_geom           geography(Point, 4326),     -- set by trigger
  created_at          timestamptz default now(),
  primary key (origin_query, destination_query)   -- the cache key + lookup index
);
```

**Trigger — two points (same pattern as §4 `set_geom`, adapted for origin+dest):**
```sql
create or replace function set_route_geom()
returns trigger language plpgsql as $$
begin
  NEW.origin_geom := ST_SetSRID(ST_MakePoint(NEW.origin_lon, NEW.origin_lat), 4326)::geography;
  NEW.dest_geom   := ST_SetSRID(ST_MakePoint(NEW.dest_lon,   NEW.dest_lat),   4326)::geography;
  return NEW;
end;
$$;

drop trigger if exists trg_set_route_geom on public.drayage_routes;
create trigger trg_set_route_geom before insert or update on public.drayage_routes
  for each row execute function set_route_geom();
```

**Spatial indexes (for future "routes near point X" queries):**
```sql
create index if not exists drayage_routes_origin_geom_idx on public.drayage_routes using gist (origin_geom);
create index if not exists drayage_routes_dest_geom_idx   on public.drayage_routes using gist (dest_geom);
analyze public.drayage_routes;
```

**RLS (same posture as `geocode_cache` — the server's service-role key bypasses it):**
```sql
alter table public.drayage_routes enable row level security;
-- no policies needed; service-role key is used server-side only.
```

---

## 6. RLS & keys

- `geocode_cache` has **RLS enabled**. The app uses the Supabase **service-role key**
  **server-side only** (`SUPABASE_SERVICE_ROLE_KEY` in `.env.local` / Vercel env — never
  `NEXT_PUBLIC_*`), which bypasses RLS for the cache read/upsert.
- The functions above are `SECURITY DEFINER`, so even an `anon`-key caller (or `supabase.rpc`
  from the browser later) can run them without table policies — they only ever return a
  boolean/coords, never raw rows.
- Never expose the service-role key to the browser.
- The **HERE** API key (`HERE_API_KEY`) is likewise server-only (used only in `lib/here.ts` via
  `getConfig()`) — never `NEXT_PUBLIC_*`, never sent to the browser. Restrict it in the HERE
  platform (Routing API + allowed domains) and rotate it if it has ever been committed/shared.

---

## 7. Verify the whole setup

```sql
-- columns are geography, not text
select table_name, column_name, udt_name
from information_schema.columns
where column_name = 'geom' and table_name in ('geocode_cache','us_ports');

-- indexes exist
select indexname, indexdef from pg_indexes
where tablename in ('geocode_cache','us_ports') and indexname like '%geom%';

-- geom populated
select count(*) total, count(geom) with_geom from geocode_cache;
select count(*) total, count(geom) with_geom from us_ports;

-- distance check uses the index (look for Index/Bitmap scan, not Seq Scan)
explain analyze
select exists (select 1 from us_ports p
  where st_dwithin(p.geom, st_setsrid(st_makepoint(-118.2437,34.0522),4326)::geography, 80467));

-- drayage_routes: geom columns are geography + populated after a route is cached
select column_name, udt_name from information_schema.columns
where table_name = 'drayage_routes' and column_name in ('origin_geom','dest_geom');
select count(*) total, count(origin_geom) with_geom from drayage_routes;
```

---

## 8. Architecture — two parallel pipelines, one shared resolver

Two structurally identical provider pipelines (Nominatim geocoder, HERE truck router) sit
side by side. The **only** coupling is that the HERE orchestrator reuses the Nominatim
orchestrator (`resolveLocation`) to turn city names into the coordinates HERE needs — a
one-directional dependency: **HERE → Nominatim, never the reverse.**

```
   CLIENT (app/page.tsx)              Next.js Route Handlers
   ─────────────────────             ──────────────────────
   "Los Angeles, CA"  ───────────▶  GET /api/geocode ?q=
   "LA" + "Santa Monica" ────────▶  GET /api/within  ?a=&b=&miles=
   "LA" + "Phoenix"   ───────────▶  GET /api/route   ?a=&b=

  NOMINATIM PIPELINE                                   HERE PIPELINE
  ──────────────────                                   ─────────────
  lib/resolve.ts                                       lib/route.ts
  resolveLocation(q)  ◀── REUSED BY /within AND /route ── resolveRoute(a,b)
        │                                                      │
        │ 1. normalize(q)                                      │ 1. check route cache FIRST
        ▼                                                      ▼
  lib/cache.ts                                           lib/routeCache.ts
  getCached → geocode_cache                              getCachedRoute → drayage_routes
        │  hit? return coords                                  │  hit? return route ✅ 0 API calls
        │  miss ↓                                              │  miss ↓
        ▼                                                      │ 2. needs coords →
  lib/geocode.ts                                              │    calls resolveLocation ───┐
  searchNominatim(q) ── HTTP ─▶ Nominatim API                │    (the box on the left)    │
        │ upsert                                              ▼ 3. fetchRoute(coordsA,B)     │
        ▼                                              lib/here.ts ── HTTP ─▶ HERE Routing v8│
  geocode_cache (Supabase/PostGIS)                           ▼ 4. upsert                    │
        ▲                                              drayage_routes (Supabase/PostGIS)    │
        └───────────── HERE "feeds from" Nominatim here ──────────────────────────────────┘
```

**Two layers of cache savings stack:**
1. Repeat **pair** (LA→Phoenix again) → served from `drayage_routes`, **zero** external calls.
2. New pair of **known cities** (Long Beach→Phoenix) → HERE is called once, but Nominatim is
   **not**, because both cities are already in `geocode_cache`.

| | Nominatim system | HERE system |
|---|---|---|
| Provider | `lib/geocode.ts` | `lib/here.ts` |
| Cache table | `geocode_cache` (`lib/cache.ts`) | `drayage_routes` (`lib/routeCache.ts`) |
| Orchestrator | `lib/resolve.ts` | `lib/route.ts` |
| Endpoint | `/api/geocode` (+ `/api/within`) | `/api/route` |
| Input → output | 1 city → coords | 2 cities → truck route |
