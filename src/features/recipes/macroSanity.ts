// Atwater cross-check — flags nutrition data whose declared calories don't
// match what its own protein/carbs/fat imply (kcal = 4P + 4C + 9F). Real bug
// found in production data: a Kassalapp-sourced ingredient ("TINE Proteinrik
// Lettost") declared 157.6 kcal/100g alongside 30g protein + 16g fat + 1.5g
// carbs — its OWN macros imply ~270 kcal, a ~112 kcal (42%) gap traced to a
// third-party source-data error, not a bug in this app's math. There was no
// way to notice this short of doing the arithmetic by hand, for every
// ingredient, every time. This is a WARNING signal only — never auto-
// corrects anything (a legitimate product can genuinely deviate: high fibre,
// sugar alcohols, alcohol content — the declared kcal is sometimes the more
// trustworthy number, not the macros).
//
// Pure + import-free by design, like progressAggregate.ts/recoveryAggregate.ts,
// so it's sucrase-verifiable without a live Supabase client.

export interface MacroConsistency {
  calories:     number
  proteinG:     number
  carbsG:       number
  fatG:         number
  /** protein×4 + carbs×4 + fat×9 */
  atwaterKcal:  number
  /** calories − atwaterKcal (positive = declared kcal is HIGHER than the macros imply) */
  deltaKcal:    number
  /** |deltaKcal| / calories, as a percentage (e.g. 42.3 = 42.3%) */
  deltaPct:     number
  /** true when the gap exceeds both the absolute and percentage tolerance */
  inconsistent: boolean
}

// Tolerance: the LARGER of a flat 50 kcal or 15% of the declared calories —
// a flat threshold alone would flag every low-calorie food (a lettuce leaf's
// rounding noise is proportionally huge but harmless in absolute terms), and
// a percentage-only threshold would miss a large absolute miss on a
// high-calorie food. 15% comfortably clears legitimate real-world deviation
// (fibre/sugar-alcohol calorie adjustments, moisture/ash content) without
// missing a genuine data error like the one that motivated this check.
const ABS_THRESHOLD_KCAL = 50
const PCT_THRESHOLD = 0.15

export function checkMacroConsistency(
  calories: number | null | undefined,
  proteinG: number | null | undefined,
  carbsG:   number | null | undefined,
  fatG:     number | null | undefined,
): MacroConsistency | null {
  if (calories == null || proteinG == null || carbsG == null || fatG == null) return null
  if (!(calories > 0)) return null
  const atwaterKcal = proteinG * 4 + carbsG * 4 + fatG * 9
  // Nothing meaningful to compare against (e.g. all three macros are zero
  // but calories is declared) — that's a missing-data case, not this check's
  // job to flag.
  if (!(atwaterKcal > 0)) return null
  const deltaKcal = calories - atwaterKcal
  const deltaPct = (Math.abs(deltaKcal) / calories) * 100
  return {
    calories, proteinG, carbsG, fatG,
    atwaterKcal: Math.round(atwaterKcal * 10) / 10,
    deltaKcal:   Math.round(deltaKcal * 10) / 10,
    deltaPct:    Math.round(deltaPct * 10) / 10,
    inconsistent: Math.abs(deltaKcal) > Math.max(ABS_THRESHOLD_KCAL, PCT_THRESHOLD * calories),
  }
}
