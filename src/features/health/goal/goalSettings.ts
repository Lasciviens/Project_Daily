// Body goals and the phase start. Since migration 113 they live on the
// day_targets row next to the phase and the daily targets — the ONE goal.
// Before 113 they are read from athlete_profile (migration 111), and before
// that from the old device-local copy; the first save that reaches the
// account moves them. Pure (scripts/verify-body-goal.cjs).

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

/** Same column names on day_targets (113) as on athlete_profile (111). */
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

/** The four goal columns — on day_targets from migration 113. */
export const GOAL_COLUMNS = ['phase_start_date', 'goal_weight_kg', 'goal_body_fat_pct', 'goal_muscle_mass_kg'] as const

/** Does a fetched row carry the goal columns (select('*') on a migrated table)? */
export function rowHasGoalColumns(row: Record<string, unknown> | null | undefined): boolean {
  return !!row && GOAL_COLUMNS.every(c => c in row)
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** A row's goal columns as clean values (numeric(5,1) may arrive as a string). */
export function goalFieldsOf(row: Record<string, unknown> | null | undefined): ProfileGoalFields {
  const day = typeof row?.phase_start_date === 'string' ? row.phase_start_date.slice(0, 10) : null
  return {
    goal_weight_kg: numOrNull(row?.goal_weight_kg),
    goal_body_fat_pct: numOrNull(row?.goal_body_fat_pct),
    goal_muscle_mass_kg: numOrNull(row?.goal_muscle_mass_kg),
    phase_start_date: validDay(day),
  }
}

/** The phase start the editor proposes: the saved one while the phase is the
 *  saved phase, today once the phase changes (the user can still edit it). */
export function phaseStartFor(nextPhase: string, savedPhase: string, savedStart: string | null, today: string): string | null {
  return nextPhase === savedPhase ? savedStart : today
}

export type BodyTargetField = keyof typeof GOAL_LIMITS
export const BODY_TARGET_UNITS: Record<BodyTargetField, string> = { goalWeightKg: 'kg', goalBodyFatPct: '%', goalMuscleMassKg: 'kg' }

/** The editor's text for a stored value ("" = not set). */
export function bodyTargetText(v: number | null): string {
  return v != null ? String(v) : ''
}

/** Parses the editor's three body-target boxes: empty clears a target, a
 *  value outside the CHECK range is an error naming the range. */
export function parseBodyTargets(text: Record<BodyTargetField, string>): {
  values: Record<BodyTargetField, number | null>
  errors: Partial<Record<BodyTargetField, string>>
} {
  const values = {} as Record<BodyTargetField, number | null>
  const errors: Partial<Record<BodyTargetField, string>> = {}
  for (const f of Object.keys(GOAL_LIMITS) as BodyTargetField[]) {
    const raw = (text[f] ?? '').trim()
    values[f] = raw === '' ? null : validGoal(f, raw)
    if (raw !== '' && values[f] == null) errors[f] = `Between ${GOAL_LIMITS[f].min} and ${GOAL_LIMITS[f].max} ${BODY_TARGET_UNITS[f]}`
  }
  return { values, errors }
}
