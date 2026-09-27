import { upsertAthleteProfile, NOT_MIGRATED_111 } from '../../training/api/athleteProfileApi'
import type { AthleteProfile } from '../../training/types.athlete'
import { EMPTY_GOAL_SETTINGS, LOCAL_GOALS_KEY, parseLocalGoals, toProfilePatch, type GoalSettings } from './goalSettings'

// Body goals live on athlete_profile (migration 111). Before that migration —
// or before migration 070 created the table — a save keeps them on this
// device instead of failing, and the hook says so. The first save that
// reaches the account writes every field (device-local values included) and
// then clears the device copy: the one-time move.

export function readLocalGoals(): GoalSettings {
  try { return parseLocalGoals(localStorage.getItem(LOCAL_GOALS_KEY)) } catch { return EMPTY_GOAL_SETTINGS }
}

function writeLocalGoals(s: GoalSettings) {
  try { localStorage.setItem(LOCAL_GOALS_KEY, JSON.stringify(s)) } catch { /* storage blocked */ }
}

function clearLocalGoals() {
  try { localStorage.removeItem(LOCAL_GOALS_KEY) } catch { /* storage blocked */ }
}

export type SaveGoalsResult = { where: 'account'; profile: AthleteProfile } | { where: 'device' }

export async function saveBodyGoals(next: GoalSettings): Promise<SaveGoalsResult> {
  try {
    const profile = await upsertAthleteProfile(toProfilePatch(next))
    clearLocalGoals()
    return { where: 'account', profile }
  } catch (e) {
    const msg = (e as Error)?.message ?? ''
    if (msg === NOT_MIGRATED_111 || /migration 070/.test(msg)) {
      writeLocalGoals(next)
      return { where: 'device' }
    }
    throw e
  }
}
