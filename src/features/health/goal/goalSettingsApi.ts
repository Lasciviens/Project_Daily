import { fetchAthleteProfile, upsertAthleteProfile, NOT_MIGRATED_111 } from '../../training/api/athleteProfileApi'
import { EMPTY_GOAL_SETTINGS, LOCAL_GOALS_KEY, parseLocalGoals, toProfilePatch, type GoalSettings, type ProfileGoalFields } from './goalSettings'

// The pre-113 homes of the body goals. Since migration 113 they live on
// day_targets (dayTargetsApi.ts reads and writes them with the rest of the
// goal); these helpers only run when that migration is missing:
//   athlete_profile (111) — read as the fallback, written when a Save can't
//                           reach the day_targets columns
//   this device           — the oldest copy (before 111), read to fill gaps
//                           and written only when neither table can take them
// The first save that reaches day_targets clears the device copy.

export function readLocalGoals(): GoalSettings {
  try { return parseLocalGoals(localStorage.getItem(LOCAL_GOALS_KEY)) } catch { return EMPTY_GOAL_SETTINGS }
}

function writeLocalGoals(s: GoalSettings) {
  try { localStorage.setItem(LOCAL_GOALS_KEY, JSON.stringify(s)) } catch { /* storage blocked */ }
}

export function clearLocalGoals() {
  try { localStorage.removeItem(LOCAL_GOALS_KEY) } catch { /* storage blocked */ }
}

/** athlete_profile's goal columns (migration 111), or null without a row. */
export async function fetchLegacyGoalFields(): Promise<ProfileGoalFields | null> {
  const p = await fetchAthleteProfile()
  return p ? { goal_weight_kg: p.goal_weight_kg, goal_body_fat_pct: p.goal_body_fat_pct, goal_muscle_mass_kg: p.goal_muscle_mass_kg, phase_start_date: p.phase_start_date } : null
}

export type LegacyGoalsSavedTo = 'profile' | 'device'

/** Saves the body goals where they lived before migration 113. */
export async function saveLegacyBodyGoals(next: GoalSettings): Promise<LegacyGoalsSavedTo> {
  try {
    await upsertAthleteProfile(toProfilePatch(next))
    clearLocalGoals()
    return 'profile'
  } catch (e) {
    const msg = (e as Error)?.message ?? ''
    if (msg === NOT_MIGRATED_111 || /migration 070/.test(msg)) {
      writeLocalGoals(next)
      return 'device'
    }
    throw e
  }
}
