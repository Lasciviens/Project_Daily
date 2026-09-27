// Body goals and the phase start — stored on athlete_profile (migration 111),
// with the old device-local values as the fallback until the first save moves
// them into the account. Pure (scripts/verify-body-goal.cjs).

export interface GoalSettings {
  goalWeightKg: number | null
  goalBodyFatPct: number | null
  goalMuscleMassKg: number | null
  /** yyyy-MM-dd */
  phaseStartDate: string | null
}

export const EMPTY_GOAL_SETTINGS: GoalSettings = { goalWeightKg: null, goalBodyFatPct: null, goalMuscleMassKg: null, phaseStartDate: null }

/** The key the old cut report used ({ goalWeightKg, cutStartDate }); the new
 *  fields are stored under it too while migration 111 is missing. */
export const LOCAL_GOALS_KEY = 'lasci.cutReport.settings'

/** Same ranges as migration 111's CHECK constraints. */
export const GOAL_LIMITS = {
  goalWeightKg: { min: 25, max: 300 },
  goalBodyFatPct: { min: 3, max: 60 },
  goalMuscleMassKg: { min: 10, max: 150 },
} as const

type NumField = keyof typeof GOAL_LIMITS

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function validGoal(field: NumField, v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN
  const { min, max } = GOAL_LIMITS[field]
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null
}

export function validDay(v: unknown): string | null {
  return typeof v === 'string' && ISO_DAY.test(v) && v >= '2000-01-01' && v <= '2100-12-31' ? v : null
}

/** Reads the device-local JSON — the old `cutStartDate` counts as the phase start. */
export function parseLocalGoals(raw: string | null): GoalSettings {
  if (!raw) return EMPTY_GOAL_SETTINGS
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    return {
      goalWeightKg: validGoal('goalWeightKg', v.goalWeightKg),
      goalBodyFatPct: validGoal('goalBodyFatPct', v.goalBodyFatPct),
      goalMuscleMassKg: validGoal('goalMuscleMassKg', v.goalMuscleMassKg),
      phaseStartDate: validDay(v.phaseStartDate) ?? validDay(v.cutStartDate),
    }
  } catch { return EMPTY_GOAL_SETTINGS }
}

export interface ProfileGoalFields {
  goal_weight_kg: number | null
  goal_body_fat_pct: number | null
  goal_muscle_mass_kg: number | null
  phase_start_date: string | null
}

/** The account's value wins; a device-local value fills a field the account
 *  doesn't have yet (before migration 111, or before the first save). */
export function resolveGoalSettings(profile: ProfileGoalFields | null, local: GoalSettings): { settings: GoalSettings; fromDevice: boolean } {
  const settings: GoalSettings = {
    goalWeightKg: profile?.goal_weight_kg ?? local.goalWeightKg,
    goalBodyFatPct: profile?.goal_body_fat_pct ?? local.goalBodyFatPct,
    goalMuscleMassKg: profile?.goal_muscle_mass_kg ?? local.goalMuscleMassKg,
    phaseStartDate: profile?.phase_start_date ?? local.phaseStartDate,
  }
  const fromDevice = (profile?.goal_weight_kg == null && local.goalWeightKg != null)
    || (profile?.goal_body_fat_pct == null && local.goalBodyFatPct != null)
    || (profile?.goal_muscle_mass_kg == null && local.goalMuscleMassKg != null)
    || (profile?.phase_start_date == null && local.phaseStartDate != null)
  return { settings, fromDevice }
}

export function toProfilePatch(s: GoalSettings): ProfileGoalFields {
  return {
    goal_weight_kg: s.goalWeightKg,
    goal_body_fat_pct: s.goalBodyFatPct,
    goal_muscle_mass_kg: s.goalMuscleMassKg,
    phase_start_date: s.phaseStartDate,
  }
}
