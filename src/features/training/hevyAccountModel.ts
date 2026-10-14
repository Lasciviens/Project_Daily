// What Settings → Subscriptions' Hevy card and the Sync toasts say about the
// account (migration 154, hevy_account): "@username · Hevy Pro · kg · km",
// whether Hevy's own workout count matches the workouts stored here, and
// what a Sync couldn't read. Pure (only the import-free date formatter;
// scripts/verify-hevy-training.cjs).
import { formatDate, formatDateTime } from '../../shared/utils/dateFormat'

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

/** The card's one warning line when the last account read failed. */
export function hevyAccountWarning(a: { last_error: string | null; last_error_at: string | null } | null | undefined): string | null {
  if (!a?.last_error) return null
  const when = a.last_error_at ? ` (${formatDateTime(a.last_error_at)})` : ''
  return `Couldn't read the Hevy account${when}: ${a.last_error}`
}

export interface WorkoutCountGap {
  hevy: number
  local: number
  /** Workouts Hevy has that the app hasn't stored. */
  missing: number
  /** Workouts stored here that Hevy no longer counts. */
  extra: number
  text: string
  /** The card's one button — any gap has one. */
  action: string
}

const workouts = (n: number) => `${n} workout${n === 1 ? '' : 's'}`

/** null when the counts agree or one of them is unknown. `local` counts only
 *  the workouts Hevy created before its count was read (hevy_created_at ≤
 *  count_checked_at), so one the webhook brought in since is no mismatch. */
export function workoutCountGap(hevy: number | null | undefined, local: number | null | undefined): WorkoutCountGap | null {
  if (hevy == null || local == null || !Number.isFinite(hevy) || !Number.isFinite(local) || hevy === local) return null
  const missing = Math.max(0, hevy - local)
  return {
    hevy, local, missing,
    extra: Math.max(0, local - hevy),
    text: `Hevy has ${workouts(hevy)}, the app has ${local}`,
    action: missing > 0 ? 'Fetch missing workouts' : 'Check workouts with Hevy',
  }
}

/** A stored workout Hevy's complete list no longer has. */
export interface StoredWorkout { id: string; title: string | null; start_time: string | null }

export interface MissingWorkoutsResult {
  added: number
  complete: boolean
  not_in_hevy: number | null
  /** Only after a complete listing (else null). */
  not_in_hevy_workouts?: StoredWorkout[] | null
  hevy_workout_count: number | null
  account_error?: string | null
}

/** The toast after "Fetch missing workouts" / "Check workouts with Hevy". */
export function missingWorkoutsMessage(r: MissingWorkoutsResult): string {
  const head = r.added > 0 ? `Fetched ${workouts(r.added)} from Hevy` : 'Nothing was missing'
  if (!r.complete) return `${head} — Hevy's list stopped early, so some may still be missing`
  if (r.not_in_hevy) return `${head} · ${workouts(r.not_in_hevy)} here ${r.not_in_hevy === 1 ? 'is' : 'are'} no longer in Hevy`
  return head
}

/** The workouts the delete question offers: only after a complete listing. */
export function workoutsToOffer(r: MissingWorkoutsResult): StoredWorkout[] {
  return r.complete ? r.not_in_hevy_workouts ?? [] : []
}

/** The check's toast — none when the delete question follows, which says
 *  the result itself (a toast would sit on top of the question). */
export function checkWorkoutsToast(r: MissingWorkoutsResult): string | undefined {
  return workoutsToOffer(r).length > 0 ? undefined : missingWorkoutsMessage(r)
}

/** The delete question for stored workouts Hevy no longer lists ("N
 *  workouts deleted · Undo" after). The message names up to three, after
 *  what the same check fetched. */
export function notInHevyQuestion(list: readonly StoredWorkout[], added = 0): { title: string; message: string; done: string } {
  const n = list.length
  const named = list.slice(0, 3).map(w => [formatDate(w.start_time), w.title?.trim()].filter(Boolean).join(' ') || 'A workout with no date')
  const more = n > 3 ? ` and ${n - 3} more` : ''
  const fetched = added > 0 ? `Fetched ${workouts(added)} from Hevy. ` : ''
  return {
    title: n === 1 ? 'Delete the workout Hevy no longer has?' : `Delete the ${n} workouts Hevy no longer has?`,
    message: `${fetched}${named.join(', ')}${more}: Hevy's full list doesn't have ${n === 1 ? 'it' : 'them'} any more (deleted in the Hevy app); the app still does.`,
    done: n === 1 ? '1 workout deleted' : `${n} workouts deleted`,
  }
}

/** What a Sync result adds to its toast when part of it couldn't be read. */
export interface HevySyncParts {
  exercise_templates?: number | null
  templates_added?: number | null
  account_checked?: boolean
  account_error?: string | null
}

/** " · exercise library not read · Hevy account not read (count: Hevy answered 500)";
 *  '' when everything was read (or the function predates 154 and says nothing). */
export function hevySyncNotes(r: HevySyncParts): string {
  const notes: string[] = []
  if (r.exercise_templates === null) notes.push('exercise library not read')
  if (r.templates_added === null) notes.push('new exercises not checked')
  if (r.account_checked === false) notes.push(`Hevy account not read${r.account_error ? ` (${r.account_error})` : ''}`)
  return notes.map(n => ` · ${n}`).join('')
}
