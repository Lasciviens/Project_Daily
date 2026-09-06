import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { toast } from '../../../app/store'

// Daily nutrition goals — a single ACTIVE DB row per user (migration 086,
// `day_targets`), replacing the old localStorage-only version
// (`useDayTargets.ts` used to persist under 'lasci.dayTargets'). A single
// browser was fine until a second device — or a cleared browser — silently
// reset the numbers to the hardcoded defaults with no way to recover them.
// `day_target_profiles` (migration 088) adds one row PER GOAL so Cut/
// Maintain/Gain each keep their own saved numbers — see upsertDayTargets.

export type NutritionGoal = 'maintain' | 'cut' | 'gain'

export interface DayTargets {
  calories: number
  protein:  number        // grams
  water:    number        // ml/day hydration goal
  goal:     NutritionGoal // steers protein g/kg + adaptive-calorie coaching
  /** yyyy-MM-dd of the last applied adaptive-calorie adjustment — enforces the
      cooldown so a user can't stack nudges before the weight trend catches up. */
  lastCalorieAdjust: string | null
}

export const DAY_TARGETS_DEFAULTS: DayTargets = {
  calories: 2200, protein: 150, water: 2000, goal: 'maintain', lastCalorieAdjust: null,
}

interface DayTargetsRow {
  user_id:             string
  calories:            number
  protein_g:           number
  water_ml:            number
  goal:                NutritionGoal
  last_calorie_adjust: string | null
  updated_at:          string
}

// day_targets (migration 086) may not be applied yet — same guard convention
// as athleteProfileApi.ts / waterApi.ts. A missing-table READ degrades to the
// same DEFAULTS the old localStorage version shipped, so no surface breaks
// on an un-migrated DB. A missing-table WRITE must NOT be a silent no-op —
// that would look exactly like data loss — so it throws a named error.
function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

const NOT_MIGRATED =
  'Daily nutrition targets are not available yet — migration 086 (day_targets) has not been applied.'

function fromRow(row: DayTargetsRow): DayTargets {
  return {
    calories:          row.calories,
    protein:           row.protein_g,
    water:             row.water_ml,
    goal:              row.goal,
    lastCalorieAdjust: row.last_calorie_adjust,
  }
}

export async function fetchDayTargets(): Promise<DayTargets> {
  const { data, error } = await supabase.from('day_targets').select('*').maybeSingle()
  if (error) {
    if (isMissingTable(error)) return DAY_TARGETS_DEFAULTS
    throw error
  }
  return data ? fromRow(data) : DAY_TARGETS_DEFAULTS
}

export async function upsertDayTargets(targets: DayTargets): Promise<DayTargets> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('day_targets')
    .upsert(
      {
        user_id:             user.id,
        calories:            targets.calories,
        protein_g:           targets.protein,
        water_ml:            targets.water,
        goal:                targets.goal,
        last_calorie_adjust: targets.lastCalorieAdjust,
      },
      { onConflict: 'user_id' },
    )
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error

  // Keep THIS goal's own saved profile (migration 088) in sync with every
  // write to the active row — this is what lets switching Cut → Maintain →
  // Cut recall Cut's real numbers instead of whatever Maintain left behind.
  // A missing `day_target_profiles` table must not fail the active-row save
  // that already succeeded above (so "Saved ✓" still shows), BUT it must
  // NOT degrade silently either — a silent skip here is indistinguishable
  // from "per-goal saving is broken", which is exactly what it looked like
  // before this warning existed. A real error (not a missing table) still
  // throws, since that's a genuine failure the mutation's own error toast
  // should surface.
  const { error: profileErr } = await supabase
    .from('day_target_profiles')
    .upsert(
      {
        user_id:    user.id,
        goal:       targets.goal,
        calories:   targets.calories,
        protein_g:  targets.protein,
        water_ml:   targets.water,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,goal' },
    )
  if (profileErr) {
    if (!isMissingTable(profileErr)) throw profileErr
    toast.warning('Saved, but per-goal memory needs migration 088 (day_target_profiles) — switching goals won’t recall this yet.')
  }

  return fromRow(data)
}

export type DayTargetProfiles = Partial<Record<NutritionGoal, Pick<DayTargets, 'calories' | 'protein' | 'water'>>>

// One saved {calories, protein, water} set per goal (migration 088) — the
// Goals editor consults this when a goal pill is tapped, instead of just
// carrying over whatever numbers the previously-selected goal had.
export async function fetchDayTargetProfiles(): Promise<DayTargetProfiles> {
  const { data, error } = await supabase.from('day_target_profiles').select('*')
  if (error) {
    if (isMissingTable(error)) return {}
    throw error
  }
  const out: DayTargetProfiles = {}
  for (const row of data ?? []) {
    out[row.goal as NutritionGoal] = { calories: row.calories, protein: row.protein_g, water: row.water_ml }
  }
  return out
}
