// What Settings → Subscriptions' Hevy card says about the account (migration
// 154, hevy_account): "@username · Hevy Pro · kg · km", and whether Hevy's
// own workout count matches the workouts stored here. Pure and import-free
// (scripts/verify-hevy-training.cjs).

export interface HevyAccountFacts {
  username: string | null
  weight_unit: string | null
  distance_unit: string | null
  is_pro: boolean | null
}

const DISTANCE_SHORT: Record<string, string> = { kilometers: 'km', miles: 'mi' }

/** The card's facts, in order; unknown ones are left out. */
export function hevyAccountFacts(a: HevyAccountFacts | null | undefined): string[] {
  if (!a) return []
  const out: string[] = []
  if (a.username) out.push(`@${a.username}`)
  if (a.is_pro === true) out.push('Hevy Pro')
  else if (a.is_pro === false) out.push('No Hevy Pro')
  if (a.weight_unit) out.push(a.weight_unit)
  if (a.distance_unit) out.push(DISTANCE_SHORT[a.distance_unit] ?? a.distance_unit)
  return out
}

export interface WorkoutCountGap {
  hevy: number
  local: number
  /** Workouts Hevy has that the app hasn't stored. */
  missing: number
  /** Workouts stored here that Hevy no longer counts. */
  extra: number
  text: string
}

const workouts = (n: number) => `${n} workout${n === 1 ? '' : 's'}`

/** null when the counts agree or one of them is unknown. `local` counts only
 *  the workouts Hevy created before its count was read (hevy_created_at ≤
 *  count_checked_at), so one the webhook brought in since is no mismatch. */
export function workoutCountGap(hevy: number | null | undefined, local: number | null | undefined): WorkoutCountGap | null {
  if (hevy == null || local == null || !Number.isFinite(hevy) || !Number.isFinite(local) || hevy === local) return null
  return {
    hevy, local,
    missing: Math.max(0, hevy - local),
    extra: Math.max(0, local - hevy),
    text: `Hevy has ${workouts(hevy)}, the app has ${local}`,
  }
}

export interface MissingWorkoutsResult {
  added: number
  complete: boolean
  not_in_hevy: number | null
  hevy_workout_count: number | null
}

/** The toast after "Fetch missing workouts". */
export function missingWorkoutsMessage(r: MissingWorkoutsResult): string {
  const head = r.added > 0 ? `Fetched ${workouts(r.added)} from Hevy` : 'Nothing was missing'
  if (!r.complete) return `${head} — Hevy's list stopped early, so some may still be missing`
  if (r.not_in_hevy) return `${head} · ${workouts(r.not_in_hevy)} here ${r.not_in_hevy === 1 ? 'is' : 'are'} no longer in Hevy`
  return head
}
