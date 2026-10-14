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
- A body change smaller than its measurement noise reads "steady" and gets no colour (`weeklyBodyChanges.ts`, `bodyGoal.GOAL_NOISE`); the scale's body score is shown, never judged.
- No composite health score and no invented derived metric. Aims agree with their band (`aimGuidance.ts`).
- Charts: hover shows values; only explicit links inside a tooltip navigate; a bar click never does.
- One date and period control for the whole page (`HealthRangeBar`), and every widget follows it: a day shows that day's value, a longer period its average (exercise: its weekly total) against the period before. Labels say "average" / "total" / "Change", never the period's length. Only a reading that can't be averaged (VO₂ max, a Hevy entry) shows the latest value with its date. No fixed 7-day windows, and no second period control on a card.
- `date` is computed from the export's own local time, never from the UTC timestamp.
