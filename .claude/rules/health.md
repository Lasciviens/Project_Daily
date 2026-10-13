---
paths:
  - "src/features/health/**"
  - "supabase/functions/health-export-webhook/**"
---
# Health rules

Background: `docs/features/health.md`.

- Apple Health (through Health Auto Export) is the only health source. Every point is stored as its own row; aggregation happens at query time per `METRIC_AGGREGATION`.
- Summed metrics (steps, energy, exercise time) collapse to one reading per hour before summing — the export re-reports the same hour. Any new consumer of `health_metrics` sums needs the same collapse (the client's `healthAggregate.ts` and `ai-proxy` each have one).
- The three sleep merges (client, `ai-proxy`, `phone-gateway`) follow one contract — change them together.
- "Last night" is only the night filed under the selected day; never show an older night as last night.
- One bodyweight series, scale first (`bodyweight.ts`); body fat and lean mass come only from the scale in use.
- No composite health score and no invented derived metric. Aims agree with their band (`aimGuidance.ts`).
- Charts: hover shows values; only explicit links inside a tooltip navigate; a bar click never does.
- One date and period control for the whole page (`HealthRangeBar`).
- `date` is computed from the export's own local time, never from the UTC timestamp.
