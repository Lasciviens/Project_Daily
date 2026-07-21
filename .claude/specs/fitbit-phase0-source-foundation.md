### Problem
Fitbit Air (Google Health API) is about to become a second health-data source
alongside Apple (Health Auto Export). The DB and aggregation layer
(`health_metrics`/`health_workouts`/`healthAggregate.ts`) currently assume one
source and would silently double-count or blend if a second one landed with no
prep. Per the CARDINAL RULE in `docs/fitbit-air-integration.md`, both sources
must always be stored in full and resolvable to exactly one winner per
`(metric, day)` for display — that resolution logic doesn't exist yet.

Full plan: `docs/fitbit-air-integration.md` (locked design + red-team
corrections). Phase roadmap + reporting: `docs/fitbit-integration-tracker.md`.
This spec covers **Phase 0 only** — device-independent, no OAuth, no poller,
no UI change. See the tracker for Phases 1–5.

### Solution
Additive migration + pure-function scaffolding, testable now against the
existing 100%-Apple dataset with synthetic dual-source fixtures. Nothing user-
visible changes in this phase.

### Files affected

#### NEW
- `supabase/migrations/062_health_source_and_sleep_segments.sql`
- `src/features/training/healthSourceDefaults.ts` — curated per-metric default source map (H3-corrected table)
- `scripts/verify-health-source-resolver.mjs` — throwaway verification script (no new test framework; repo has none)

#### MODIFIED
- `src/features/training/healthMetrics.ts` — register `oxygen_saturation` (minmaxavg), `skin_temperature` (latest), `active_zone_minutes` (sum), `sleeping_heart_rate` (latest)
- `src/features/training/healthAggregate.ts` — add the C1/H2 resolver (single winning `source_family` per metric/day, presence-aware fallback), applied once inside the shared group-by-date path used by `computeDailySeries`/`computeHeartRateDailySeries`/`computeSleepSummary`
- `src/features/training/api/healthApi.ts` — `fetchHealthMetricSeries(metricName, from, to, sourceFamily?)`
- `supabase/functions/health-export-webhook/index.ts` — stamp `source_family: 'apple'` explicitly on every inserted `health_metrics`/`health_workouts` row

### Tasks (ordered, with agent assignment and parallelism)

**T1** `mira` — Write `062_health_source_and_sleep_segments.sql`:
```sql
ALTER TABLE public.health_metrics
  ADD COLUMN IF NOT EXISTS source_family text NOT NULL DEFAULT 'apple'
    CHECK (source_family IN ('apple','fitbit','manual'));

ALTER TABLE public.health_workouts
  ADD COLUMN IF NOT EXISTS source_family text NOT NULL DEFAULT 'apple'
    CHECK (source_family IN ('apple','fitbit','manual'));

CREATE TABLE IF NOT EXISTS public.health_sleep_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  stage text not null check (stage in ('light','deep','rem','wake','asleep')),
  source text,
  source_family text not null default 'fitbit' check (source_family in ('apple','fitbit','manual')),
  created_at timestamptz not null default now()
);
ALTER TABLE public.health_sleep_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "health_sleep_segments_owner" ON public.health_sleep_segments
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS health_sleep_segments_user_start_idx
  ON public.health_sleep_segments (user_id, start_at DESC);

CREATE TABLE IF NOT EXISTS public.health_source_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_name text not null,
  source_family text not null check (source_family in ('apple','fitbit')),
  updated_at timestamptz not null default now(),
  unique (user_id, metric_name)
);
ALTER TABLE public.health_source_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "health_source_prefs_owner" ON public.health_source_prefs
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```
No audit trigger (matches the existing bulk-synced-table exemption — hevy_*/health_*).
No backfill UPDATE needed — `NOT NULL DEFAULT 'apple'` fills every existing row
correctly on its own (Huawei data already arrives via Apple HealthKit, so there
is no non-Apple family in the data today regardless of the raw `source` string).

**T2** `deploy` — one-line change in `health-export-webhook/index.ts`: add
`source_family: 'apple'` to both the `health_workouts` and `health_metrics`
row objects it constructs, then manually redeploy that function (Edge Function
change + deploy is `deploy`'s domain per the delegation table, not `mira`'s —
`mira` owns the migration only). Unrelated to migration 062's own manual-apply
step, but do both before Phase 0 is considered live.

**T3** (parallel with T1/T2) **engineer** (no specialist persona fits — this is
plain TS logic in an existing feature file, not DB/auth/CI/layout/breakage) —
`healthMetrics.ts` + new `healthSourceDefaults.ts`: register the 4 new metric
names and the curated default-source map. Pure data, no logic.

**T4** (depends on T1's column existing, but code can be written against T3 in
parallel) **engineer** — `healthAggregate.ts` resolver (C1/H2): resolve winning
`source_family` per `(metric_name, date)` — prefer the curated default IF it
has data that day, else fall back to the other family, never blend — filter
points to the winner BEFORE `aggregateGroup` runs, in the one shared place
(`groupByDate`/`aggregateGroup` call site), not per caller.

**T5** (depends on T2, T4) **engineer** — `healthApi.ts`'s
`fetchHealthMetricSeries` gains the optional `sourceFamily` filter param.

**T6** (depends on T3, T4) **engineer** — verification script: run the
resolver against (a) a synthetic fixture with one Apple + one Fitbit-tagged
point for the same metric/day, asserting no double-count and correct fallback,
and (b) real fetched Apple-only data, asserting byte-identical output to
pre-change behavior.

**T7** (final) engineer — `npm run build`, draft PR on
`claude/fitbit-phase0-source-foundation`, file the phase report per
`docs/fitbit-integration-tracker.md`'s template.

### Open questions
- `oxygen_saturation`'s aggregation type is locked as `minmaxavg` (assumed
  `heart_rate`-shaped) purely as a placeholder — no real payload exists yet to
  confirm. Revisit in Phase 3.
- Whether the "zero drift" acceptance check runs against live production data
  (59,973 rows) or only synthetic fixtures + the user's own visual check of the
  Health tab depends on the user opting in to DB access that turn (CLAUDE.md
  rule — not assumed).
