# Fitbit Air → Google Health API — execution tracker

> Living status doc for the multi-phase integration. `docs/fitbit-air-integration.md`
> is the frozen DESIGN (cardinal rule, decision, metric matrix, red-team corrections
> — read that first, it does not change). **This file is the only place phase
> status/decisions get updated as work happens** — since the container resets every
> session, this + git history is the sole memory of "where are we."
>
> PM of record: the `project-manager` agent persona. Every phase ends with a report
> to PM using the template in §Reporting; PM returns GO / NO-GO / adjust before the
> next phase starts. No phase's code merges to `main` without that GO.

---

## Status at a glance

| # | Phase | Status | Device needed? | Gated on |
|---|---|---|---|---|
| 0 | Source-aware foundation (schema + aggregation) | ✅ **DONE 2026-07-21** — PRs #351+#352 merged, migration 062 applied, July re-baselined hourly. Apple's own dedup independently reproduced the resolver's numbers (Jul-10 = 5,721 both ways). | No | — |
| 1 | OAuth token-lifetime spike (H6) | 🟢 **IN FLIGHT — consent click-through PASSED 2026-07-21** (Restricted + Production + unverified → 'Gelişmiş → devam' appeared). Refresh token captured; 7-day refresh test due **≥2026-07-28**. Live API sweep done → docs/google-health-api-surface.md. | No | — (parallel with 0) |
| 2 | OAuth production wiring | ✅ **DONE 2026-07-21 (user-directed redesign: unified "Connect Google")** — no new client/table/functions needed: the existing calendar-oauth/token pair + `user_calendar_tokens` now carry Calendar+Tasks+Health on ONE token; scope union shipped in `SettingsMenu.tsx`. Gate override: user waived the 7-day wait (vacation deadline) after research showed the 7-day expiry is Testing-status-only and Google documents an explicit personal-use exception for unverified Production restricted-scope apps; 28 Jul refresh test downgraded to non-blocking formality. | No | — |
| 3 | Poller + first live pull | ✅ **LIVE 2026-07-21 12:03 UTC — FIRST REAL FITBIT PULL SUCCEEDED.** DB evidence: fitbit-family rows landed (steps 672 on day one, hourly HR Min/Avg/Max, active energy), sync_state last_success set, zero errors; resolver united apple 2,959 + fitbit 672 (1 overlap hour) → UI ≈3,099 — gap-fill without double-count, the CARDINAL RULE on real dual-source data. Fixed en route: CORS (#354), stale-token surfacing (#355), and the decisive one: Google Health API rejects mixed-scope access tokens (403 DISALLOWED_OAUTH_SCOPES naming cl_events,tasks) → down-scoped refresh (#356) keeps ONE consent/token while minting health-only access tokens. Remaining: cron (user), first sleep night → §11 SpO2/sleep shapes, v1.1 metrics. | No longer blocked — Air arrived | Phase 0 merged ✅, Phase 2 merged ✅, `get_health_stats` source-aware (URGENT, not yet done), platform filter ✅ implemented |
| 4 | UI + AI wiring (source switch, Sleep, mini-cards, coach) | ⏸ Blocked | Yes (real data to show) | Phase 3 producing real rows |
| 5 | Hardening (reconciliation, stale banner, webhook upgrade) | ⏸ Blocked | No | Phase 3/4 shipped |

Update the Status column + add a dated line under that phase's Log every time
something changes. Statuses: `not started` / `in progress` / `blocked` / `done`.

---

## Phase 0 — Source-aware foundation

**Goal:** make `health_metrics`/`health_workouts` and the aggregation layer
source-family-aware, with zero behavior change for existing Apple data. Pure
schema + pure-function work — no device, no OAuth, no UI.

**Locked scope** (confirmed + adjusted from the candidate in the design doc's §12,
see Decision Log for why):
1. Migration `062_health_source_and_sleep_segments.sql`:
   - `health_metrics` + `health_workouts` gain `source_family text NOT NULL DEFAULT 'apple' CHECK (IN ('apple','fitbit','manual'))`. Flat default is correct, not a simplification-that-loses-data: Huawei already flows through Apple HealthKit before it reaches us (see CLAUDE.md's Health Auto Export section), so every existing row genuinely is `'apple'` family regardless of its raw `source` string — no per-row string-matching needed. Adding a `NOT NULL DEFAULT <constant>` column is a fast metadata-only op in modern Postgres, not a full rewrite, so this is safe at 59,973 rows.
   - `CREATE TABLE health_sleep_segments` (id, user_id, start_at, end_at, stage, source, source_family default 'fitbit', created_at) + owner RLS. Created empty, unused until Phase 3 — zero behavioral risk. No audit trigger (matches the existing bulk-synced-table exemption convention).
   - `CREATE TABLE health_source_prefs` (user_id, metric_name, source_family, updated_at, unique(user_id,metric_name)) + owner RLS — **added now** even though its UI lands in Phase 4 (see Decision Log: this needs to be a DB table, not localStorage, and it's free to ship the empty table alongside 062 rather than a second migration later).
   - New `metric_name`s registered (inert — nothing writes them yet): `oxygen_saturation`, `skin_temperature`, `active_zone_minutes`, `sleeping_heart_rate`.
2. `src/features/training/healthMetrics.ts` — add the 4 metric names to `METRIC_AGGREGATION` (`active_zone_minutes`→sum, `skin_temperature`→latest, `sleeping_heart_rate`→latest, `oxygen_saturation`→**minmaxavg, locked-for-now** — matches `heart_rate`'s shape assumption for a continuous overnight vital; re-verify against the first real Fitbit payload in Phase 3 and correct here if the API actually returns single-point samples, not Min/Avg/Max).
3. `src/features/training/api/healthApi.ts` — `fetchHealthMetricSeries` gains an optional `sourceFamily?: 'apple' | 'fitbit'` param (adds `.eq('source_family', ...)` when passed; omitted = today's behavior, unchanged).
4. `src/features/training/healthAggregate.ts` — implement the C1/H2 resolver (single winning `source_family` per `(metric, day)`, presence-aware fallback, applied once inside the shared group-by-date path, never a per-caller filter) using a new curated default map (`healthSourceDefaults.ts`, per §13 H3's corrected table — reversed for continuity/cumulative metrics once Fitbit is live, kept Apple for running dynamics/mobility/audio/cardio-recovery/VO2max/weight, Fitbit-always for sleep). The map exists now purely as inert config — with only one source family in the DB there's nothing for it to switch between yet.
5. `supabase/functions/health-export-webhook/index.ts` — one-line addition: stamp `source_family: 'apple'` explicitly on every row it inserts (belt-and-suspenders per H1 — don't rely on the column default alone once a second webhook exists).
6. A throwaway verification script (`scripts/verify-health-source-resolver.mjs` or under the scratchpad first) — **not a new test framework** (repo has none — no vitest/jest in `package.json`, only Playwright for E2E). Imports the resolver + aggregation functions directly, runs them against (a) a synthetic dual-source fixture (one Apple + one Fitbit-tagged point, same metric/day) proving no double-count and correct fallback, and (b) real fetched Apple-only data proving byte-identical output to pre-change behavior. This is the "regression test for a both-sources day" C1 asks for, in a form that matches this repo's existing convention (`scripts/generate-matvaretabellen-seed.mjs`, `scratchpad/e2e-standard.mjs`) instead of introducing a new dependency as a side effect of a DB/aggregation phase.

**Explicitly OUT of scope for Phase 0:** no new UI, no tab/section/button, no poller,
no OAuth, no touching `docs/fitbit-air-integration.md`'s locked content (PM owns
that doc's single cross-reference line, added separately).

**Engineer (code):**
- ~~Branch `claude/fitbit-phase0-source-foundation`~~ → actually shipped on `claude/charming-newton-yhk8i` / **PR #351**, which already carries the design-doc commits — PM verified this is the correct continuation, not a scope miss (see Log).
- Original 6 items — shipped, commit `85b2a67`; **redesigned per the 2026-07-21 escalation** (stream-level hourly/day/night resolver, `health_source_prefs` dropped) — shipped, commit `52e1db2`, PM-verified correct (see Log 2026-07-21b, 3 minor non-blocking asks)
- `npm run build` green — reported by coordinator both times; **PM has no code-execution tool this session, so this is never independently re-run**, only cross-checked by reading the diff for anything that would plausibly break `tsc`
- Draft PR against `main` — done (#351)

**User (manual):**
- Apply migration `062` (Supabase Dashboard → SQL Editor, or `supabase db push`)
- Redeploy `health-export-webhook` after the `source_family` stamp lands (Dashboard or CLI — "Enforce JWT Verification" stays OFF, unchanged)
- Optional: explicitly opt in this turn if you want the "zero drift" check run against live prod data instead of only synthetic fixtures + your own read of the Health tab (per CLAUDE.md: direct DB access is opt-in per request, not assumed for the whole project)
- Review + merge the PR — **PM GO issued 2026-07-21** (superseding the 2026-07-20 conditional GO, which was overtaken by the redesign) once the 3 minor findings in Log 2026-07-21b are addressed or explicitly accepted

**Definition of done:**
- [ ] Migration applied (pending — user), `npm run build` passes (reported green both times, never independently executed by PM)
- [ ] `health-export-webhook` redeployed with the explicit stamp (pending — user)
- [x] Verification script — PM hand-traced all 25 assertions in `scripts/verify-health-source-resolver.cjs` against the actual shipped resolver code (real 2026-07-10/07-07 data shapes, gap-filling union, HR/sleep/day-strategy cases) — all correct
- [ ] Manual click-through of Health tab shows the **expected, deliberate** change (steps/distance/energy totals drop to their correct deduped values; everything else unchanged) — blocked on migration apply, the true "Phase 0 fully done" closer, not a merge blocker
- [x] New metric names present in `METRIC_AGGREGATION`, don't crash `getAggregationType`
- [x] No UI/route/component changed
- [x] `flights_climbed` exclusion carried forward into the redesign, now with an explicit regression test (`ladder: flights_climbed apple-first`) — stronger than before, was just a comment

**Log:**
- 2026-07-20 — PM: scope locked, GO issued. See Decision Log below for the 5 adjustments made to the design doc's candidate scope.
- 2026-07-20 — **Phase 0 gate report received** (branch `claude/charming-newton-yhk8i`, PR #351, head `85b2a67`). PM independently verified against the actual diff (not taken on the report's word alone): confirmed via `.git/logs/HEAD` that this branch/head is genuinely PR #351 continuing directly from the 3 design-doc commits — the "didn't open a new branch" deviation is correct, not a scope miss, PR #351 already *is* the design doc's home. Read migration `062` in full: matches locked scope, `(select auth.uid())` RLS pattern confirmed against migrations `046`+`051` (claim was accurate). Read `healthAggregate.ts`/`healthSourceDefaults.ts`/`healthMetrics.ts`/`healthApi.ts`/the webhook diff in full and hand-traced all 17 assertions in `scripts/verify-health-source-resolver.cjs` against the actual shipped resolver code — every one checks out (dual-source non-double-count, presence-aware fallback, per-day independence, HR never cross-sources min/max, sleep never sums two sessions). Confirmed `sucrase` really is in `package-lock.json` (script is actually runnable, not just plausible). The scope-expansion deviation (resolver also wired into `computeHourlyBuckets`/`computeHeartRateHourlySeries`/`extractSleepSessions`, `computeBasalEnergyDailySeries` covered transitively) is verified real and **welcomed** — it closes a gap in PM's own original Phase 0 spec, which only named the 3 daily-series functions; without it, hourly Day-view charts would have stayed unresolved while daily/weekly views were correct, a real Phase-4-discovered inconsistency avoided.
  **One real finding, fixed directly by PM (not just flagged):** `healthSourceDefaults.ts`'s `FITBIT_DEFAULT` set incorrectly included `flights_climbed`. The design doc is explicit and HIGH-confidence that the Air has no altimeter/barometer and cannot produce this metric at all (§2/§8, "Stays Apple SE2 — Air can't produce") — `flights_climbed` is not in H3's reversal list either, so nothing supersedes that. **Zero runtime impact** (Fitbit will never write this metric, so the resolver's presence-based fallback always resolves to Apple regardless — this was a documentation/policy-correctness bug, not a data bug), but left uncorrected it contradicts the locked design doc for anyone reading this file fresh in a future session. PM removed it from the Set directly (one line + a "don't re-add it" comment) since it was unambiguous, doc-mandated, and zero-risk. **This edit is currently UNCOMMITTED in the working tree — coordinator must commit it (e.g. folded into the existing Phase 0 commit or as a small follow-up) before this branch is considered final.**
  **What PM could NOT independently verify:** the `npm run build` "green, 6.04s" result — no code-execution tool available in this session, so that claim is taken on trust pending the coordinator's own re-confirmation after committing the fix above (the fix is a one-line Set-literal change with no type implications, so it should not affect the build result, but re-run it after committing regardless).
  **Verdict: GO to merge**, once (a) the flights_climbed fix above is committed, (b) build is re-confirmed green after that commit. Migration apply + webhook redeploy remain the user's manual steps and can happen before or after merge — the code is inert/safe either way (verified by the fast-path identity proof). Final "Health tab shows zero drift" click-through happens after the user applies 062 + redeploys — that's the true closing check for calling Phase 0 fully done in this tracker, not a merge blocker.

- **2026-07-21 — OFF-CADENCE ESCALATION, redesign approved (GO), Phase 0 scope revised.** User reviewed Phase 0 pre-merge (good timing — PR not merged, migration not applied, zero production exposure) and rejected the `health_source_prefs` preference-table model; their actual requirement is **gap-filling**, not a manual per-metric toggle. Coordinator was granted live DB read access this turn (opt-in, per CLAUDE.md) and found: **`step_count` is empirically double-counted TODAY, within the Apple family alone, unrelated to Fitbit** — 2026-07-10 shows Watch-stream 5,721 + Phone-stream 4,634 in the *same* hours (hour 07: both report exactly 103 — literally the same physical steps counted twice) → app displays 10,355 for a ~5,700-step day; same pattern 2026-07-19; `active_energy` had identical-shape duplicate delivery on 2026-07-07 (Huawei era). This falsifies the assumption in the original `healthAggregate.ts` comment that differing source strings are "time-disjoint" (e.g. Watch joining partway through a day) — for these two metrics they are NOT — they genuinely overlap.
  **PM ruling (GO on all three asks):**
  1. **Redesign approved**: hourly-slice union resolver (bucket each stream by hour → one winning stream per hour by a priority ladder → this both gap-fills, per H2's original continuity goal, AND prevents same-hour double-counting — a strict improvement over the day-level family-winner model, which could only pick one family for the WHOLE day and would have dropped legitimate gap-filling data from the loser family).
  2. **Zero-drift redefinition approved**: "byte-identical to today" was never the actual goal — it was a proxy for "don't introduce new bugs as a side effect of adding source-family plumbing." Insisting on literal byte-identity would mean deliberately shipping a resolver KNOWN to produce a 10,355-step day. Redefined: output identical **except** where today's output is a proven, empirically-verified bug (same-family multi-stream double-count), which the new resolver correctly fixes.
  3. **Stays ONE phase, not a 0.5.** Agreed with coordinator's reasoning: nothing is live yet (PR unmerged, migration unapplied), so there is no "already shipped, now patching" scenario — this is pre-merge design correction, exactly what a phase gate exists for. Splitting it would mean deliberately merging code known to be wrong first for no benefit.
  4. **`health_source_prefs` dropped from migration 062, approved.** Zero cost (unapplied, empty) and removes dead scaffolding for a UX pattern the user explicitly rejected — YAGNI, add a real table later only if Phase 4 genuinely needs a persistent override. **Action required**: also scrub the now-stale `health_source_prefs` references out of `healthSourceDefaults.ts`'s comments when this lands, or it becomes exactly the kind of doc/code drift this project keeps getting bitten by.
  **PM technical refinements requested before code is written:**
  - **Scope the 3-tier ladder precisely.** "Apple Watch > Fitbit > iPhone" is right for the true cumulative/summed metrics where a phone is a real plausible stream: `step_count`, `walking_running_distance`, `active_energy`, `basal_energy_burned`, `active_zone_minutes`. It should NOT apply to the nightly/physiological metrics (`heart_rate`, `resting_heart_rate`, `heart_rate_variability`, `respiratory_rate`, `oxygen_saturation`, `skin_temperature`, `sleeping_heart_rate`) — a phone cannot sense any of these, so "iPhone" isn't a real 3rd rung there; those stay a 2-tier apple-vs-fitbit competition (still resolved hourly, for the same reason — avoids cross-device min/max blending once Fitbit HR arrives in Phase 3 — just without a phone entry). **This also supersedes the Decision Log's earlier H3-based lock for the cumulative metrics specifically** — the user has now spoken directly (their data, their call: wrist beats pocket), which supersedes the red-team's inferred default. The physiological metrics' Fitbit-continuity reasoning from H3 is untouched (user's comment was specifically about steps).
  - **The hourly resolver's output must be a flattened/unioned POINT SET, not a pre-summed number.** "Day total = sum of hourly winners" is only mathematically correct for `sum`-type metrics. For `heart_rate` (minmaxavg) and any `average`-type metric, "sum of hourly totals" would be nonsense. Correct generalization: resolve the winning stream per hour, flatten the winning points back into one array for the day, then hand that array to the EXISTING (unchanged, already-verified) `aggregateGroup`/`rangeFromPoints` functions exactly as today — this works uniformly across every aggType with no special-casing in the resolver itself.
  - **Spot-check `basal_energy_burned` and `walking_running_distance` for the same overlap pattern** while DB access is still granted this turn — both are equally plausible dual-stream (Watch+Phone) candidates and weren't in the two dates already checked. Better to fix all of them in this one pass than have a future session rediscover the same bug in a sibling metric.
  - **Verification script**: add fixture cases pinned to the REAL 2026-07-10 (`step_count`) and 2026-07-07 (`active_energy`) data shapes, proving the new resolver produces the correct (~5,700 / deduped) totals, not just synthetic dual-source cases.
  - **Carry forward the `flights_climbed` fix** into whatever the rewritten default/priority config becomes — don't let it regress in the rewrite. (Aside, not blocking: iPhone actually DOES have a barometer and can report `flights_climbed`, unlike Fitbit Air — so if this metric ever gets its own tier treatment later, "phone can't do this" does NOT apply to it the way it does to the physiological metrics above. Not in scope now.)
  **Ask before writing code**: get the user's explicit sign-off on this CONCRETE design (priority order + the literal before/after step numbers), not just the general gap-filling requirement — it's their personal data changing by a real, visible amount (10,355 → ~5,700), they should see that delta before it ships, not just the abstract policy.
- 2026-07-21 — Engineer: REDESIGN implemented per user approval + PM GO. Stream-level resolver (hour/day/night strategies, ladders manual>watch>fitbit>phone for cumulative per user's word, fitbit-first for physiological+sleep, apple-first rest incl. flights_climbed). health_source_prefs DROPPED from 062; sleep_segments gained natural unique key + synced_at/updated_at; composite source_family indexes added. Verification 25/25 incl. real-data-shaped fixtures; LIVE replay of real 2026-07-10 step data: 10,355 → 5,721. Build green.
- 2026-07-20 — Engineer: all six code items complete. Migration `062` written; webhook `source_family:'apple'` stamp added; 4 metric names registered; `healthSourceDefaults.ts` + the C1/H2 resolver landed (applied via one shared helper in every raw-point consumer); `fetchHealthMetricSeries` gained the optional filter. `npm run build` (tsc -b + vite) **green**. Verification script `scripts/verify-health-source-resolver.cjs` runs against the REAL module (via sucrase) — **17/17 PASS**, incl. array-identity zero-drift proof + dual-source no-double-count. Two DoD items are user-gated (migration apply, webhook redeploy) and the Health-tab click-through waits on the apply. **Deviation:** shipped on the existing `claude/charming-newton-yhk8i` branch (PR #351), not a new `claude/fitbit-phase0-*` branch — the harness pins this session to that branch; noted for PM. Awaiting PM GO for Phase 1 (which is already GO in parallel).
- **2026-07-21b — PM independently verified the redesign (commit `52e1db2`) against the real diff — not taken on the report's word.** Confirmed via `.git/logs/HEAD` (commits `85b2a67`→`68ddcfa5`→`096ecd7d`→`52e1db2`). Read migration `062` (health_source_prefs genuinely absent, only a historical comment remains; `health_sleep_segments` gained `source_record_id`/`synced_at`/`updated_at` + a natural unique key for idempotent re-delivery; composite source_family indexes added — all sound), `healthSourceDefaults.ts` (new `StreamTier`/`ResolveStrategy` types, `BUCKET_METRICS`/`CUMULATIVE`/`FITBIT_FIRST` sets, 3 ladders), and `healthAggregate.ts`'s `resolveSourcePoints` in full, then **hand-traced every one of the 25 assertions** in `scripts/verify-health-source-resolver.cjs` against the actual shipped code (real 2026-07-10 step shape, active_energy duplicate-tier tie-break, cross-family gap-filling union, heart-rate fitbit-first-hourly, sleep manual>fitbit>apple, day-strategy weight/HRV) — every one is mathematically correct by trace. Confirmed no orphaned references to the old `resolveSourcePerDate`/`familyOf` names anywhere in the repo (clean rename, consistent with a real green build). The manual-sleep-priority fix is real: `streamTierOf` puts `'manual'` as rung 1 of every ladder, so it now wins at the resolver level before `computeSleepSummary`'s own (now-redundant-but-harmless) manual filter ever runs.
  **Three minor, non-blocking findings — fix quickly or explicitly accept, don't need another PM round-trip:**
  1. `CUMULATIVE` (gets the ladder) includes `apple_exercise_time`/`apple_stand_time`/`time_in_daylight`, which are **not** in `BUCKET_METRICS` (gets hourly resolution) — so they'd resolve at DAY granularity despite being cumulative/summed metrics. Low risk in practice (all three are Apple-exclusive per the design doc, same class as `flights_climbed` — Fitbit can never write them, so day-vs-hour is probably moot) but it's an unexplained asymmetry between the two config sets and wasn't in your summary. Either move them into `BUCKET_METRICS` for consistency, or add a one-line comment saying why not.
  2. `computeSleepSummary`'s old `manualPts`/`sourcePts` filter (lines ~401-402) is now dead weight — `resolveSourcePoints` already guarantees manual wins before this code ever runs. Harmless, optional cleanup.
  3. The `'bucket'` strategy's window key (`recorded_at.slice(0,13)`, i.e. UTC hour) doesn't literally match `computeHourlyBuckets`' local-hour display bucketing — verified this causes **no actual bug** (Oslo's UTC offset is always a whole number of hours, even across DST, so UTC-hour and local-hour boundaries are the same real-time boundaries, just different labels) but a one-line comment explaining that equivalence would save a future reader from re-deriving it.
  **Verdict: PM GO to merge.** None of the three findings above block anything — fix them in the same commit or a fast follow-up, whichever is less friction, then merge. Migration apply + webhook redeploy remain the user's manual steps (unchanged from before).
  **New Phase 3 entry-gate items, added to the tracker's Phase 3 card** (both raised by the coordinator, both approved): poller must call `dataPoints.list` (intraday), never `dailyRollUp`, for every cumulative metric — a pre-aggregated daily number can't feed the hourly bucket-merge this whole redesign depends on; and `ai-proxy`'s `get_health_stats` must be made source-aware and redeployed **before** the poller starts writing real `fitbit` rows, or the AI reproduces on its own separate aggregation path the exact double-count bug just fixed on the frontend.
  **Phase 1 note**: the OAuth Playground smoke test (informational peek at a real Google Health API payload, now that the Air has arrived and is being worn) is approved — useful, low-risk, no app code, still the user's own manual OAuth clicking. One flag: Google's Playground defaults to ITS OWN shared OAuth client, which almost certainly cannot request Restricted `googlehealth.*` scopes for an arbitrary user — the "Use your own OAuth credentials" toggle must be set to the throwaway project's real Client ID/Secret, or the scope simply won't be grantable and it'll look like a mysterious failure. **This smoke test does not shortcut Phase 1's actual gate** — the 7-day refresh-token-durability wait and the Restricted-scope click-through confirmation are unchanged and still required before Phase 2 starts.
- **2026-07-21c — PHASE 0 CLOSED (PR #351 + #352 merged). PM verified the closure report's key claims directly, not on trust:**
  - `CLAUDE.md`'s migration-041 section **already corrects itself in place** ("corrected 2026-07-21: with Time Grouping: Hours it genuinely does aggregate... 'Hours' is now the REQUIRED setting") and gained a full new dated bullet ("Intra-stream workout twins, real bug, fixed 2026-07-21") documenting the twins bug + the fix trio + the Apple-dedup cross-validation. No action needed — this is exactly the kind of correction CLAUDE.md is supposed to capture, done well.
  - `collapseIntraStreamMinuteDuplicates` (`healthAggregate.ts`) read in full: groups by `(stream, minute)`, keeps the point with the larger `qty` per group, identity-fast-paths when nothing was dropped. Correctly called from both `computeDailySeries` and `computeHourlyBuckets`, gated on `getAggregationType(metricName) === 'sum'` — exactly the "sum metrics only, AFTER inter-stream resolution" design described, and NOT applied to `heart_rate`/minmaxavg (correct — a same-minute float-noise twin skews an average by a hair, it doesn't inflate a sum ~2.7×, much lower severity, reasonably left alone).
  - `docs/google-health-api-surface.md` read in full — genuinely live-verified (fetched `$discovery` doc + a real token sweep, not inferred), directly actionable, high quality.
  - My 3 minor findings from the prior review: (1) bucket-set asymmetry — fixed, confirmed; (3) UTC-hour comment — added, confirmed; (2) sleep dead-code — declined, accepted (I'd flagged it as optional myself).
  - **PM follow-up questions (informational report, no ask expected back on cadence — but worth answering at the next natural touchpoint, not urgent):** did the July `health_metrics` wipe (67,626 rows) touch any `source='manual'` sleep-correction rows from earlier in July? Those don't exist in HealthKit and can't be recovered by re-export — worth one explicit check that "14 sleep nights intact" isn't quietly missing a manual night. Separately: what's the root cause of the Google Health API mirroring HealthKit back (`dataSource.platform: HEALTH_KIT`) — the Google Health iOS app's own passive HealthKit read access, or something specific to this test? Matters for how much to trust a simple platform-equality filter long-term; add to `docs/google-health-api-surface.md` if/when known.
  - **Phase 2 stays untouched pending Phase 1's 28 Jul verdict — agreed, correct per plan.** Next real gate: Phase 1 pass/fail after the refresh-token test, whenever that lands (informational updates before then are welcome but not required).

---

## Phase 1 — OAuth token-lifetime spike (H6)

**Goal:** resolve the single biggest risk before any poller code is written: does a
**Restricted**-scope (`googlehealth.*`) OAuth client sitting in **Production,
unverified** actually let a real person click through consent (rather than hard-
blocking until Google verification), and does the resulting refresh token survive
past 7 days? This is a throwaway-project experiment, not app code — nothing here
touches the `Project_Daily` repo.

**Runs in parallel with Phase 0** — no shared dependency.

**Engineer:** none in-repo. Optionally a scratch script (curl/Node, kept outside the
repo) to call the token-exchange/refresh endpoints and log raw responses.

**User (manual — this phase is ~all you):**
1. Create a throwaway Google Cloud project.
2. OAuth consent screen: **External**, publish to **Production** (not Testing), stay unverified. Decide first: is `power.no` a Google Workspace org? If yes, consider an **Internal** user type instead (no 100-user cap, no verification, no 7-day token limit) — cleaner if it qualifies; note the tradeoff (employer-tied identity) either way.
3. Add exactly the scopes from the design doc §7 (`googlehealth.activity_and_fitness.readonly`, `googlehealth.health_metrics_and_measurements.readonly`, `googlehealth.sleep.readonly`).
4. Self-consent — confirm whether the "unverified app → Advanced → continue" click-through actually appears for these **Restricted** scopes (not just Sensitive-tier ones like Calendar) rather than hard-blocking.
5. Capture the `refresh_token` from the code exchange.
6. Wait **≥7 calendar days**, then attempt a fresh access-token refresh with it.
7. Record the exact result (pass, or the exact error).

**Definition of done:**
- [x] Click-through behavior for Restricted scopes confirmed — **PASSED 2026-07-21**: External+Production+unverified genuinely shows "Gelişmiş → devam" (Advanced → continue) for `googlehealth.*` Restricted scopes. The plan's single biggest unknown (§6, H6, H7) is resolved in the design's favor.
- [ ] Refresh token tested past 7 days — token captured 2026-07-21, test due ≥2026-07-28, not yet due
- [ ] Workspace/Internal-eligibility for `power.no` determined — not yet addressed (moot for now since the unverified-Production path already passed; only matters as a fallback if the 7-day test fails)
- [ ] Recommendation on record — pending the 28 Jul result; leaning External-Production-unverified given the click-through already passed

**Escalate immediately (don't wait for the 7-day mark) if:** the click-through
itself is blocked/forces verification — that changes Phase 2's design before any
more time is sunk waiting on the clock.

**Log:**
- 2026-07-20 — PM: GO issued, start whenever convenient — the 7-day clock is the
  gating factor, not engineering effort, so starting early costs nothing.
- 2026-07-21 — Engineer: consent click-through PASSED. Refresh token captured, 7-day test now running (due ≥28 Jul). Bonus live API sweep (user-provided short-lived token, not the refresh-token path) against the real `$discovery` doc → `docs/google-health-api-surface.md`: all 32 data types confirmed kebab-case path ids, real payload shapes captured (minute-grain steps/energy as numeric STRINGS, HR as single samples not Min/Avg/Max, STAGES sleep with `metadata.externalId`), and a critical finding — `dataPoint.dataSource.platform` can be `FITBIT` or `HEALTH_KIT` (the Google Health iOS app mirrors Apple HealthKit into this same API) — logged as a new mandatory Phase 3 gate (see Phase 3 section + Decision Log).
- 2026-07-21 — PM: independently read `docs/google-health-api-surface.md` in full — high-quality, genuinely live-verified (not inferred), directly actionable. Confirmed via git log this came from a real discovery-doc fetch + a real token sweep, not guesswork. **Two follow-ups, not blocking Phase 1 itself:**
  1. The `platform` filter should be an explicit **allowlist** (`platform === 'FITBIT'` passes; anything else — `HEALTH_KIT`, unknown/missing, or some future third value — gets dropped and logged) rather than a blocklist (`platform !== 'HEALTH_KIT'`). A blocklist would silently admit an unanticipated third platform string mislabeled as Fitbit; default-deny is the safer stance and matches this project's existing convention (ai-proxy's default-deny table allow-list).
  2. Please get (or add to the surface doc if already known) the ROOT CAUSE of the HealthKit mirroring — is it because the Google Health iOS app itself holds HealthKit read permission and passively republishes it to the cloud API for every user, or something specific to this account/setup? This matters for how much to trust a simple equality filter going forward (e.g. whether it could ever apply to more data types than observed in one sweep).
  3. Separately, for the Phase 0 closure (not Phase 1): did the July `health_metrics` wipe touch any `source='manual'` sleep-correction rows from earlier in July? Those are NOT recoverable from a HealthKit re-export (manual entries never existed in HealthKit) — worth one explicit check that "14 sleep nights intact" isn't silently missing a manual night that was wiped and never re-entered.
  - 2026-07-21 — Engineer answers to PM's three follow-ups:
  1. **Platform ALLOWLIST — agreed and locked**: Phase 3 spec will use `platform === 'FITBIT'` (pass) / everything else dropped **and counted in the poller's response** (`skipped_non_fitbit`), mirroring the webhook's `skipped_*` counters — default-deny, per the ai-proxy convention.
  2. **HealthKit-mirroring root cause**: the Google Health iOS app itself — during Air setup it requests Apple HealthKit READ permission (user grants it so the app can show a unified picture) and republishes that data to the cloud API. So the mirror is a per-account consequence of a permission the user granted, not an API-wide constant: revoking HealthKit access in the Google Health app would stop it, and NEW data types could join the mirror whenever Apple-side sources add them. The equality allowlist is therefore the only stance that stays correct as the mirror's contents drift. (Recorded in docs/google-health-api-surface.md.)
  3. **Manual sleep rows — verified ZERO lost, checked BEFORE the wipe, not after**: `health_metrics?source=eq.manual` returned an empty set prior to deletion (the audit transcript's "manual-source rows (must be preserved) → []"). No manual entry ever existed in July; nothing unrecoverable was deleted.
  **Ratifying the platform-filter finding as the single most critical of the three Phase 3 entry gates** — a `dailyRollUp`-vs-`list` mistake produces wrong numbers; a missed platform filter produces wrong numbers **that look like real Fitbit data**, silently, permanently, and in direct violation of the CARDINAL RULE's "both sources stored in full, correctly tagged" requirement. Phase 3 spec must treat this as non-negotiable, not a nice-to-have.

---

## Phase 2 — OAuth production wiring

**Goal:** real, deployed OAuth plumbing for Google Health, isolated from the
working Calendar integration. **Gated on Phase 1 PASS** (design depends on which
token posture won). Still device-independent — consent doesn't require a paired
Fitbit.

**⚠️ SUPERSEDED 2026-07-21 — everything below this line is the ORIGINAL plan,
kept for the record, NOT what shipped.** User-directed override (vacation
deadline, "Connect Google yeterli"): ONE unified consent on the EXISTING
Calendar OAuth client/project (Calendar+Tasks+3 health scopes together), ONE
refresh token in the EXISTING `user_calendar_tokens` — no dedicated client, no
`user_health_tokens` table, no separate `google-health-oauth`/`google-health-token`
functions. PM accepted this as a legitimate call within the user's own
authority over their single-user app's risk posture (see Phase 3's Log,
2026-07-21d, for the full reasoning and the one follow-up verification ask).
Actual shipped Phase 2 = a scope-union change in `SettingsMenu.tsx` only.

**Locked decisions carried in from Phase 1 output:** (fill in once Phase 1 reports)

**Engineer (code):**
- `supabase/functions/google-health-oauth/index.ts` — auth-code exchange, **`state` CSRF param bound to session**, `verify_jwt` **ON** (unlike the two bulk-sync webhooks — this is a real user-initiated redirect, not a public webhook)
- `supabase/functions/google-health-token/index.ts` (mirrors `calendar-token`) — mints/refreshes access tokens on demand
- `supabase/migrations/063_health_tokens.sql` — **new sibling table** `user_health_tokens` (user_id, provider, refresh_token, scope, created_at, updated_at, unique(user_id,provider)) — deliberately NOT extending `user_calendar_tokens` (that table's `unique(user_id)` constraint would need loosening, for no benefit, and risks the one thing this project's cardinal rule cares about: never touch the working Apple pipeline destructively — this extends to not touching the working Calendar OAuth path either)
- Frontend: "Connect Fitbit Air (Google Health)" entry point (Training → Health, or Settings), reusing the existing `@react-oauth/google` popup pattern
- Reconnect banner + `app_error_logs` write on any refresh failure (H6's mandatory monitored-failure path)
- Update CLAUDE.md's Environment Variables + Edge Functions tables (new Vault secrets, new functions) — per CLAUDE.md's own "update this file when architecture changes" rule

**User (manual):**
- Create a **dedicated** OAuth client for Health scopes in the real (non-throwaway) Cloud project — separate from Calendar's `GOOGLE_CLIENT_ID`/`SECRET`, so Restricted-scope verification/quota consequences can never bleed into the working Calendar integration
- Add `GOOGLE_HEALTH_CLIENT_ID` / `GOOGLE_HEALTH_CLIENT_SECRET` to Supabase Vault
- Register the redirect URI on the OAuth client
- Apply migration `063`, deploy the new function(s)
- Do the real consent click-through once, confirm a token row exists

**Definition of done:**
- [ ] Token row present after consent (value itself never logged/printed anywhere — Guardian-style check)
- [ ] On-demand refresh works
- [ ] Reconnect banner verified by deliberately invalidating the stored token
- [ ] CLAUDE.md tables updated
- [ ] `npm run build` green, PR drafted

---

## Phase 3 — Poller + first live pull *(device-gated)*

**Goal:** `google-health-sync` actually pulling real Fitbit Air data into
`health_metrics`/`health_sleep_segments`, resolving every §11 open item against
real payloads.

**Gated on:** Phase 0 merged (✅ done), Phase 2 merged (token minting works),
**device in hand and worn for several days** (✅ Air arrived + being worn as of
2026-07-21 — device requirement satisfied, sleep/HRV/SpO2 evidence still
accumulates with wear time).

**THREE mandatory entry gates (superseding the original §13-derived read-method
table below, which was speculative — this is now live-verified, see
`docs/google-health-api-surface.md`):**
1. Fetch every cumulative metric via `dataTypes/{kebab-id}/dataPoints` (the
   intraday **list** endpoint), never `dailyRollUp` — a pre-aggregated daily
   number cannot feed the hourly bucket-merge Phase 0's resolver depends on.
2. `ai-proxy`'s `get_health_stats` must be made source-aware and redeployed
   BEFORE this poller starts writing real `fitbit` rows, or the AI reproduces
   the double-count bug Phase 0 just fixed, on its own separate aggregation path.
3. **(Most critical, PM-ratified)** Drop every point where
   `dataPoint.dataSource.platform != "FITBIT"` — the Google Health iOS app
   mirrors Apple HealthKit into this same API, so an unfiltered pull re-stores
   the webhook's own Apple data a second time, mislabeled `source_family='fitbit'`.
   Implement as an **allowlist** (`platform === 'FITBIT'` passes, everything
   else — including unknown/missing — is dropped and logged), not a blocklist.

**Engineer (code):**
- `supabase/functions/google-health-sync/index.ts` — built against the VERIFIED
  surface in `docs/google-health-api-surface.md` (kebab-case path ids per data
  type; filter grammar is snake_case and differs by type-class — interval /
  sample / daily / session / sleep-end-time; numeric strings → `Number()`;
  `weightGrams`→kg; civil time → our `date` column, same rule as the Apple
  webhook), the 3 gates above, sequential requests (≤2.5 QPS unverified-safe),
  chunked upsert (mirrors the Apple webhook's `CHUNK_SIZE` pattern)
- Sleep → `health_sleep_segments` rows from `stages[]` (+ `metadata.externalId`
  as `source_record_id`) — also emit a `sleep_analysis`-shaped `health_metrics`
  row (Fitbit family) so existing charts work before Phase 4's UI lands
- HR: decide store-raw-samples vs. pre-bucket-to-Min/Avg/Max-at-ingest (surface
  doc leans raw-samples; watch rate limits given ~1-sample/5s density)
- Manual "Fetch now" trigger for testing ahead of a cron schedule
- Resolve remaining §11 flags against real payloads: SpO2 shape (`oxygenSaturation` samples vs `dailyOxygenSaturation` summary — which the Air actually populates, confirms/corrects Phase 0's locked `minmaxavg` guess), skin-temp fields, VO2max presence, AFib/IRN presence, any Premium-gating surprise

**User (manual):**
- Continue wearing the Air (overnight especially) — sleep/HRV/SpO2 evidence still accumulating
- Set the ~3h cron schedule once manual-trigger results look right
- Apply any follow-up migration this phase's real-payload findings require

**Definition of done:**
- [x] Intraday-list-not-rollup gate — implemented, PM-verified by reading `listDataPoints()`: hits `dataTypes/{id}/dataPoints`, never `:rollUp`/`:dailyRollUp`
- [ ] **get_health_stats source-aware + deployed — NOT done, PM says this is now URGENT, not sequenced** (see Log)
- [x] Platform allowlist gate — implemented, PM-verified: `p?.dataSource?.platform === 'FITBIT'` exact match, else `skipped.nonFitbit++`; nothing else passes
- [x] Hourly ingest grain gate — implemented, PM-verified: cumulative metrics summed per civil hour; HR samples collapsed to one `{Min,Avg,Max}` row/hour (matches the Apple minmaxavg shape exactly); sleep → `health_sleep_segments` (stage-mapped, natural-key upsert) + one `sleep_analysis`-shaped aggregate row (LIGHT→core, per the design doc's own Core≈Light equivalence); wake-day date derived from the API's own civil/UTC-offset fields, matching the existing `sleepNightKey` convention
- [ ] One real sample of every net-new metric captured and sanity-checked
- [ ] Sleep segments reconstruct a real night matching the Fitbit app's own view
- [ ] Rate-limit usage observed vs. the ~1,120 req/day estimate
- [ ] Every §11 open item resolved (confirmed or corrected) — update the design doc's §11 checkboxes, not this file, since that's the doc's job

**Log:**
- **2026-07-21d — PM response to the off-cadence report (PR #353, gate overrides + Phase 2/3 shipped).**

  **1. 7-day-wait waiver — ACCEPTED, on the technical merits, not just because it's reported as user-directed.** The reasoning holds up on its own: the design doc's own H6 always said "Production = durable, Testing = 7-day" per Google's documented model — the click-through (the part that was genuinely uncertain) already passed. The 7-day wait was a confirmatory validation of an already-well-documented claim, not the load-bearing risk. Failure mode if the assumption is somehow wrong for Restricted scopes specifically is graceful (`reconnect_required` + banner, already implemented) not silent/destructive. The 28 Jul check is preserved as a non-blocking formality rather than dropped outright. No objection.

  **2. Phase 2 consolidation (one client, one token table) — ACCEPTED as within the user's own authority over their single-user app's risk posture**, and honestly characterized (blast radius genuinely is "one reconnect click" for a personal app with no other users to protect) rather than glossed over. This supersedes my original dedicated-client/separate-table recommendation, which was a reasonable default absent a time-boxed personal constraint, not a hard requirement. **One verification ask, not a blocker**: when you report the first real Fitbit pull, explicitly confirm it succeeded using the CURRENT row in `user_calendar_tokens` (not a manually-inserted test token) — the unified re-consent needs to have actually forced `prompt=consent` to mint a refresh token covering the NEW scope union (Google can omit a fresh refresh_token on a re-consent for an already-authorized user if `prompt=consent` isn't forced), otherwise the UI could show "connected" while the stored token still only covers the old Calendar-only scopes. Cheap to confirm as part of the pull you're already about to report.

  **3. Code review of `google-health-sync/index.ts` + migration `063` + `FitbitSyncButton.tsx` — read in full, not taken on the summary.** Auth logic is sound: shared-secret path only fires on an exact header match, otherwise falls through to a REAL `supabase.auth.getUser(jwt)` check (same correct pattern as `calendar-oauth`), userId is always resolved from the validated caller (JWT `user.id` or the single hardcoded id for the secret path) rather than any client-supplied parameter, so there's no cross-user data risk even hypothetically. Upsert conflict keys correctly reuse the EXISTING unique indexes from migrations 041/062 (no new index needed, idempotent re-delivery confirmed by inspection). `FitbitSyncButton.tsx` correctly uses `useMutationWithFeedback` (the mandatory-toast convention) with a proper reconnect message and `min-h-[44px]`. Migration 063: clean, idempotent, correctly RLS'd read-only-for-owner (service role writes, no user-write policy needed) — one purely cosmetic nit, no `created_at` column (AGENTS.md's usual convention), harmless for a single-row-per-user upsert table, not worth a follow-up migration just for that.
     All three gates are exactly as ratified. Genuinely good work under real time pressure.

  **4. DISAGREE with the get_health_stats sequencing — flagging as requested.** The reasoning given ("stays correct until fitbit rows exist, first pulls are user-triggered," sequenced "before the cron is enabled") treats the 3h cron as the "poller goes live" moment. It isn't — **the Fetch-now button is already live in this same merged PR**, callable by the user (or anyone at the keyboard) right now, and a single click writes real `source_family='fitbit'` rows into production `health_metrics` immediately. My original gate's intent was "before any real fitbit row can exist," not "before the scheduled cron specifically." Concretely: **please check right now whether Fetch-now has already been clicked** (query `google_health_sync_state.last_success_at` / whether any `health_metrics` rows with `source_family='fitbit'` already exist) — if yes, the AI is already able to give a double-counted answer to a health question today, not hypothetically later. Either way, **ship `get_health_stats` source-awareness next, immediately, ahead of any further polish or the cron enablement** — not "next code item" in a loose sense, but before anything else lands. Given the user is about to lose access to this setup, this is also the kind of small-but-easy-to-drop item that a "next session" might never happen for once the primary stakeholder is unavailable to re-prioritize it — better to close it out now while there's still a session to do it in.

---

## Phase 4 — UI + AI wiring

**Goal:** surface Fitbit data per the CARDINAL RULE (any metric, any source, on
demand) without violating the Width Standard (W5 — peek on demand, not permanent
screen area) or the prior "no derived Sleep Score/Readiness" decision (H5).

**Engineer (code):** Health tab Apple⇄Fitbit source-switch chrome per section;
Sleep section reads `health_sleep_segments` (real hypnogram) with Fitbit as
default, falling back to Apple `sleep_analysis` only on nights with no Fitbit
data; mini-cards for the 4 new metrics; `useHealthSourcePrefs` UI wired to
`health_source_prefs`; `get_health_stats` (ai-proxy) made source-aware + redeploy;
optionally re-engage the `sports-scientist`/`strength-coach` agent personas if PT
Coach's snapshot should incorporate HRV/RHR/AZM (same pattern used to originally
build that feature).

**User (manual):** redeploy `ai-proxy`; mobile-first review at 393/1469/2450px.

**Definition of done:**
- [ ] Reference-viewport check (393/1469/2450) — no overflow, chips/peeks not permanent screen area
- [ ] `min-h-[44px]`, `accent-*` not `amber-*`, Headless UI Dialog if any modal — the standard checklist
- [ ] H5 confirmed NOT violated (no reintroduced derived sleep score/efficiency)
- [ ] AI answers a source-specific question correctly ("Fitbit'e göre uykum nasıldı")

---

## Phase 5 — Hardening

**Goal:** `last_successful_sync`/`last_error` persistence + a stale-data banner,
a daily reconciliation pull inside the 14-day query-range cap (an outage longer
than that is otherwise permanently unrecoverable — no backfill by design),
decide on the webhook-push upgrade (deferred by default per §10).

**Definition of done:** left open until Phase 3/4 ship — fill in once there's
real operational experience to harden against.

---

## Reporting cadence + format

**Cadence:** one report per phase, filed when that phase's DoD checklist is fully
checked (or genuinely blocked) — not a running diary. **Escalate off-cadence**
(don't wait for the phase boundary) if: an acceptance check fails, a migration
errors on apply, Phase 1's 7-day test fails, or a §11/H-item resolves in a way
that changes a locked default (e.g. SpO2's aggregation type turns out wrong).

**Every phase-gate report must contain:**
1. Phase # and name
2. Branch name + PR link (if code shipped)
3. DoD checklist, each line ticked with one-line evidence (not just "done")
4. `npm run build` result
5. Manual steps completed vs. still pending (be explicit — "migration written, NOT yet applied" is a valid, common state)
6. Deviations from locked scope, and why
7. New unknowns/surprises surfaced
8. The explicit ask: "GO for Phase N+1?" and anything you think should change about that next phase's locked scope

PM responds with GO / NO-GO / adjust-and-resubmit before the next phase's code
starts.

---

## Decision log

Append-only, dated. This is where ambiguous/undecided points from the design doc
get closed out as the project actually proceeds.

- **2026-07-20 — `source_family` NOT NULL, not nullable.** Doc's H1 said "must
  never be NULL" but only specified backfill + COALESCE. Locked: `NOT NULL
  DEFAULT 'apple'` at the column level (strongest guarantee, cheap at this
  scale) **plus** the explicit webhook stamp H1 also asked for — belt-and-
  suspenders, not either/or.
- **2026-07-20 — `health_source_prefs` is a DB table, not localStorage.** Doc
  left this as "(Optional) ... only if the per-metric default must be
  AI-readable server-side." It must be: `ai-proxy` is a server-side Deno
  function and cannot read the browser's localStorage, and §5 requires "AI
  reads the default unless told otherwise." `useDayTargets`'s localStorage
  precedent doesn't apply here — day targets are never read server-side, this
  preference is. Table added in Phase 0 (schema-complete in one migration);
  its read/write UI lands in Phase 4.
- **2026-07-20 — Token storage is a new sibling table, not an extension of
  `user_calendar_tokens`.** That table has `unique(user_id)` (single row per
  user); loosening it to `(user_id, provider)` to share it across two OAuth
  integrations touches a live, working table for no real benefit. New
  `user_health_tokens` table in Phase 2 instead.
- **2026-07-20 — Dedicated OAuth client for Health scopes, not reusing
  Calendar's.** `googlehealth.*` scopes are Restricted (stricter than
  Calendar's Sensitive tier); keeping them on a separate Cloud OAuth client
  means any future verification/CASA/quota consequence of the Restricted tier
  can never affect the working Calendar integration.
- **2026-07-20 — No new test framework.** Repo has no vitest/jest (`package.json`
  confirmed — only `@playwright/test` for E2E, no unit-test runner). Phase 0's
  "testable against existing rows" ships as a throwaway verification script
  under `scripts/` (matches existing precedent: `scripts/generate-matvaretabellen-seed.mjs`,
  `scratchpad/e2e-standard.mjs`), not as a new dependency decision riding along
  on a DB/aggregation phase.
- **2026-07-20 — `oxygen_saturation` aggregation type locked as `minmaxavg`
  for now.** Doc's own §9 left it ambiguous ("latest/minmaxavg"). Assumed to
  arrive shaped like `heart_rate` (continuous overnight vital) until the first
  real payload proves otherwise (Phase 3 DoD item).
- **2026-07-20 — Live production DB reads during phase-gate acceptance are
  opt-in per turn, not blanket for this project.** Per CLAUDE.md: direct
  Supabase access with the user's own credentials is opt-in per request, even
  mid-investigation. A phase report that wants to diff against the real
  59,973-row dataset must have that asked for in that turn, not assumed because
  the project is "in progress."
- **2026-07-21 — HAE Time Grouping MUST be "Hours" (root-cause of intra-stream
  twins found and fixed).** User-reported: 2026-07-20 showed 15,362 steps vs
  Apple's own 5,731. Diagnosis (live DB): starting a Fitness-app workout makes
  HealthKit hold overlapping step samples; with the automation's Time Grouping
  on "Default" HAE exported raw overlapping samples (88/94 minutes as
  float-noise twins in ONE stream). Fixes: (1) display backstop — same-stream
  same-minute keeps max, sum metrics only (PR #352, permanent); (2) source
  config — Health Metrics automation set to Summarize ON + **Time Grouping:
  Hours** (CLAUDE.md's old "HAE ignores Summarize" note corrected: Hours DOES
  aggregate); (3) user-approved wipe of ALL July health_metrics (67,626 rows
  across three passes) + hourly re-export 01–21 Jul → DB now uniform hourly,
  single-stream, zero mixed grain. Cross-validation: Apple's own dedup produced
  5,721 for Jul-10 — identical to resolveSourcePoints' output from the dirty
  data. 20 Jul = 5,732 (user expected 5,731).
- **2026-07-21 — Phase 1 click-through risk RESOLVED (the plan's #1 unknown).**
  Restricted googlehealth.* scopes on a Production, unverified app DO surface
  the "Google hasn't verified this app → Gelişmiş → continue" path. Remaining
  Phase 1 gate is only the ≥7-day refresh-token survival test (due 28 Jul+).
  Bonus: full live API sweep completed same day (kebab-case ids, FITBIT
  platform filter requirement, real payload shapes) — Phase 3's poller spec is
  now observation-backed, zero guessed endpoints.
