import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import {
  EMPTY_GOAL_SETTINGS, GOAL_COLUMNS, goalFieldsOf, resolveGoalSettings, rowHasGoalColumns, toProfilePatch,
  type GoalSettings,
} from '../../health/goal/goalSettings'
import { clearLocalGoals, fetchLegacyGoalFields, readLocalGoals, saveLegacyBodyGoals } from '../../health/goal/goalSettingsApi'

// The goal — ONE row per user (`day_targets`): the phase (cut / maintain /
// gain) with the day it started, the daily calorie / protein / water targets
// and the body targets (goal weight, body fat %, muscle mass). Migration 086
// created the row for the daily targets (they used to live in localStorage
// only); migration 113 moved the phase start and the body goals here from
// athlete_profile, so Food, Daily and Health read and save the SAME row
// through one editor. `day_target_profiles` (migration 088) keeps one saved
// calorie / protein / water set PER PHASE — see upsertDayTargets. The body
// targets are one set for every phase (owner decision). Migration 153 added
// the owner's own carb and fat goals to both (NULL = worked out — see
// health/goal/cutDecision.dayMacroTargets).

export type NutritionGoal = 'maintain' | 'cut' | 'gain'

export interface DayTargets extends GoalSettings {
  calories: number
  protein:  number        // grams
  water:    number        // ml/day hydration goal
  /** Grams; null = worked out from calories and protein (cutDecision.dayMacroTargets). */
  carbs:    number | null
  fat:      number | null
  goal:     NutritionGoal // the phase: steers protein g/kg + adaptive-calorie coaching
  /** yyyy-MM-dd of the last applied adaptive-calorie adjustment — enforces the
      cooldown so a user can't stack nudges before the weight trend catches up. */
  lastCalorieAdjust: string | null
}

export const DAY_TARGETS_DEFAULTS: DayTargets = {
  calories: 2200, protein: 150, water: 2000, carbs: null, fat: null, goal: 'maintain', lastCalorieAdjust: null,
  ...EMPTY_GOAL_SETTINGS,
}

/** What the goal query holds. */
export interface DayTargetsState {
  targets: DayTargets
  /** Some body goal still comes from this device's old copy — a Save moves it. */
  fromDevice: boolean
}

export const DAY_TARGETS_PLACEHOLDER: DayTargetsState = { targets: DAY_TARGETS_DEFAULTS, fromDevice: false }

/** Where a Save put the body goals: the goal row, or (before migration 113)
 *  athlete_profile, or (before 111 too) this device — or 'unchanged' when a
 *  pre-113 save didn't touch them (a Coach "Apply", a calorie edit). */
export type BodyGoalsSavedTo = 'day_targets' | 'profile' | 'device' | 'unchanged'

export interface DayTargetsSaveResult { state: DayTargetsState; bodyGoalsSavedTo: BodyGoalsSavedTo }

interface DayTargetsRow {
  user_id:             string
  calories:            number
  protein_g:           number
  water_ml:            number
  /** Missing before migration 153. */
  carbs_g?:            number | null
  fat_g?:              number | null
  goal:                NutritionGoal
  last_calorie_adjust: string | null
  updated_at:          string
  [column: string]:    unknown
}

// day_targets (086) may not be applied yet — same guard convention as
// athleteProfileApi.ts / waterApi.ts. A missing-table READ degrades to the
// DEFAULTS; a missing-table WRITE throws a named error (a silent no-op would
// look exactly like data loss). Missing goal COLUMNS (113) degrade both ways:
// reads fall back to athlete_profile, a write saves the daily targets here
// and the body goals in their old place, with a warning.
function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

function isMissingColumn(e: unknown, columns: readonly string[]): boolean {
  const x = e as { code?: string; message?: string }
  if (x?.code !== 'PGRST204' && x?.code !== '42703') return false
  const msg = x?.message ?? ''
  return columns.some(c => msg.includes(c))
}
const isMissingGoalColumn = (e: unknown) => isMissingColumn(e, GOAL_COLUMNS)

// The owner's carb and fat goals (153). Before it: reads give null (worked
// out), a save without them retries without the columns, a save WITH one
// throws MACROS_NOT_MIGRATED. Remove the fallback once 153 has run live.
const MACRO_COLUMNS = ['carbs_g', 'fat_g'] as const
const isMissingMacroColumn = (e: unknown) => isMissingColumn(e, MACRO_COLUMNS)

const NOT_MIGRATED =
  'Your goal can’t be saved yet — migration 086 (day_targets) has not been applied.'
const MACROS_NOT_MIGRATED =
  'Carb and fat goals can’t be saved yet — migration 153 has not been applied. Leave them empty to save the rest.'

function dailyFromRow(row: DayTargetsRow): Omit<DayTargets, keyof GoalSettings> {
  return {
    calories:          row.calories,
    protein:           row.protein_g,
    water:             row.water_ml,
    carbs:             row.carbs_g ?? null,
    fat:               row.fat_g ?? null,
    goal:              row.goal,
    lastCalorieAdjust: row.last_calorie_adjust,
  }
}

function settingsOf(t: GoalSettings): GoalSettings {
  return { goalWeightKg: t.goalWeightKg, goalBodyFatPct: t.goalBodyFatPct, goalMuscleMassKg: t.goalMuscleMassKg, phaseStartDate: t.phaseStartDate }
}

function sameSettings(a: GoalSettings, b: GoalSettings): boolean {
  return a.goalWeightKg === b.goalWeightKg && a.goalBodyFatPct === b.goalBodyFatPct
    && a.goalMuscleMassKg === b.goalMuscleMassKg && a.phaseStartDate === b.phaseStartDate
}

/** athlete_profile's goals for a pre-113 read. Best-effort: a failed read
 *  only blanks the body targets — it must never take the phase and the daily
 *  targets (rings, water, the brief, the report) down with it. */
async function legacyGoalFieldsOrNull(): ReturnType<typeof fetchLegacyGoalFields> {
  try {
    return await fetchLegacyGoalFields()
  } catch (e) {
    void logError('day_targets: legacy body-goal read failed', { error: (e as Error)?.message ?? String(e) })
    return null
  }
}

export async function fetchDayTargets(): Promise<DayTargetsState> {
  const { data, error } = await supabase.from('day_targets').select('*').maybeSingle()
  if (error && !isMissingTable(error)) throw error
  const row = (error ? null : data) as DayTargetsRow | null
  const daily = row ? dailyFromRow(row) : DAY_TARGETS_DEFAULTS
  // Post-113 the row is the goal; before it (or with no row yet) the body
  // goals come from athlete_profile. The old device copy fills any gap either way.
  const account = rowHasGoalColumns(row) ? goalFieldsOf(row) : await legacyGoalFieldsOrNull()
  const { settings, fromDevice } = resolveGoalSettings(account, readLocalGoals())
  return { targets: { ...daily, ...settings }, fromDevice }
}

/** `previous` is the goal as loaded: before migration 113 a save whose body
 *  goals (and phase start) equal it — and none of them sits on this device
 *  only — leaves athlete_profile alone and warns about nothing. */
export async function upsertDayTargets(targets: DayTargets, previous?: DayTargetsState): Promise<DayTargetsSaveResult> {
  const user = await requireUser()
  const row: Record<string, unknown> = {
    user_id:             user.id,
    calories:            targets.calories,
    protein_g:           targets.protein,
    water_ml:            targets.water,
    carbs_g:             targets.carbs,
    fat_g:               targets.fat,
    goal:                targets.goal,
    last_calorie_adjust: targets.lastCalorieAdjust,
    ...toProfilePatch(targets),
  }
  const run = () => supabase.from('day_targets').upsert(row, { onConflict: 'user_id' }).select().single()
  let { data, error } = await run()
  // Before 153: fine while no carb or fat goal is set, a named error otherwise.
  const withoutMacros = async () => {
    if (targets.carbs != null || targets.fat != null) throw new Error(MACROS_NOT_MIGRATED)
    for (const c of MACRO_COLUMNS) delete row[c]
    ;({ data, error } = await run())
  }
  if (error && isMissingMacroColumn(error)) await withoutMacros()
  let bodyGoalsSavedTo: BodyGoalsSavedTo = 'day_targets'
  if (error && isMissingGoalColumn(error)) {
    for (const c of GOAL_COLUMNS) delete row[c]
    ;({ data, error } = await run())
    if (error && isMissingMacroColumn(error)) await withoutMacros()
    if (!error) {
      // A device-only copy still moves on any save (the editor promises it).
      bodyGoalsSavedTo = previous && !previous.fromDevice && sameSettings(settingsOf(targets), settingsOf(previous.targets))
        ? 'unchanged'
        : await saveLegacyBodyGoals(settingsOf(targets))
    }
  }
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  if (bodyGoalsSavedTo === 'day_targets') clearLocalGoals()

  // Keep THIS phase's own saved profile (migration 088) in sync with every
  // write to the active row — this is what lets switching Cut → Maintain →
  // Cut recall Cut's real numbers instead of whatever Maintain left behind.
  // A missing `day_target_profiles` table must not fail the save that already
  // succeeded above, BUT it must not degrade silently either; a real error
  // still throws so the mutation's own error toast surfaces it.
  const profile: Record<string, unknown> = {
    user_id:    user.id,
    goal:       targets.goal,
    calories:   targets.calories,
    protein_g:  targets.protein,
    water_ml:   targets.water,
    updated_at: new Date().toISOString(),
  }
  // 153 adds the carb and fat columns to both tables at once.
  if ('carbs_g' in row) { profile.carbs_g = targets.carbs; profile.fat_g = targets.fat }
  const { error: profileErr } = await supabase.from('day_target_profiles').upsert(profile, { onConflict: 'user_id,goal' })
  if (profileErr) {
    if (!isMissingTable(profileErr)) throw profileErr
    toast.warning('Saved, but per-phase memory needs migration 088 (day_target_profiles) — switching phases won’t recall this yet.')
  }

  const saved = data as DayTargetsRow
  const goals = bodyGoalsSavedTo === 'day_targets'
    ? resolveGoalSettings(goalFieldsOf(saved), EMPTY_GOAL_SETTINGS).settings
    : settingsOf(targets)
  const fromDevice = bodyGoalsSavedTo === 'device'
  return { state: { targets: { ...dailyFromRow(saved), ...goals }, fromDevice }, bodyGoalsSavedTo }
}

export type DayTargetProfiles = Partial<Record<NutritionGoal, Pick<DayTargets, 'calories' | 'protein' | 'water' | 'carbs' | 'fat'>>>

// One saved {calories, protein, water, carbs, fat} set per phase (migrations
// 088, 153) — the goal editor consults this when a phase is tapped, instead of
// carrying over whatever numbers the previously-selected phase had.
export async function fetchDayTargetProfiles(): Promise<DayTargetProfiles> {
  const { data, error } = await supabase.from('day_target_profiles').select('*')
  if (error) {
    if (isMissingTable(error)) return {}
    throw error
  }
  const out: DayTargetProfiles = {}
  for (const row of data ?? []) {
    out[row.goal as NutritionGoal] = { calories: row.calories, protein: row.protein_g, water: row.water_ml, carbs: row.carbs_g ?? null, fat: row.fat_g ?? null }
  }
  return out
}
