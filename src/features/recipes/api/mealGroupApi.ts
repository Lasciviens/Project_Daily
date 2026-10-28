import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { deleteRows, restoreRows, type DeletedRows } from '../../../shared/utils/deletedRows'
import { addFoodLogEntries, isMissingGroupTitle, type LoggedFood } from './foodLogApi'
import { ingredientSnapshot, recipeSnapshot, amountUnit, isCustomItem, isRecipeItem, itemsToEntries, type BasketItem, type LogItem } from '../foodBasket'
import type { FoodLogEntryInput, MealSlot } from '../types'

// A dish = the diary rows sharing a meal_group_id (087, "As meal"); its own
// name is meal_group_title on each of them (158). Every change here is one
// update on those rows (food_log_entries is audited) and returns what the
// rows were before, so the caller's toast can offer Undo. A taken supplement
// dose's line (160) never moves day or meal: a dish's move, Edit meal and
// Copy to leave it where it is.

/** Where a diary row sits, and in which dish — what a move, an ungroup or a "Move out of meal" changes and its Undo puts back. */
export interface RowPlace { id: string; date: string; meal_slot: MealSlot; meal_group_id: string | null; meal_group_title: string | null }

export const NOT_MIGRATED_158 = 'Naming a dish needs migration 158 (meal_group_title), which has not been applied yet.'

const PLACE = 'id, date, meal_slot, meal_group_id'

// Before 160 the column is missing and no row is a dose.
function isMissingDoseColumn(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /supplement_schedule_id/i.test(x?.message ?? '')
}

type PlaceRow = RowPlace & { supplement_schedule_id?: string | null }

async function readPlaces(filter: { group?: string; ids?: readonly string[] }): Promise<PlaceRow[]> {
  const q = (cols: string) => {
    const base = supabase.from('food_log_entries').select(cols)
    return filter.group ? base.eq('meal_group_id', filter.group) : base.in('id', [...(filter.ids ?? [])])
  }
  let { data, error } = await q(`${PLACE}, meal_group_title, supplement_schedule_id`)
  if (error && isMissingDoseColumn(error)) ({ data, error } = await q(`${PLACE}, meal_group_title`))
  if (error && isMissingGroupTitle(error)) ({ data, error } = await q(PLACE))
  if (error) throw error
  return ((data ?? []) as unknown as PlaceRow[]).map(r => ({ ...r, meal_group_title: r.meal_group_title ?? null }))
}

/** Writes `patch` to the rows `where` picks (scoped to the account), dropping the dish name before 158. */
async function updateRows(patch: Record<string, unknown>, where: { group?: string; ids?: readonly string[] }): Promise<void> {
  const user = await requireUser()
  const run = (p: Record<string, unknown>) => {
    const base = supabase.from('food_log_entries').update(p).eq('user_id', user.id)
    return where.group ? base.eq('meal_group_id', where.group) : base.in('id', [...(where.ids ?? [])])
  }
  let { error } = await run(patch)
  if (error && isMissingGroupTitle(error) && 'meal_group_title' in patch) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { meal_group_title, ...rest } = patch
    ;({ error } = await run(rest))
  }
  if (error) throw error
}

/** Moves a dish to another meal and/or day (a taken dose's line stays); returns where its rows were. */
export async function moveMealGroup(groupId: string, to: { date: string; slot: MealSlot }): Promise<RowPlace[]> {
  const before = (await readPlaces({ group: groupId })).filter(r => !r.supplement_schedule_id)
  if (before.length) await updateRows({ date: to.date, meal_slot: to.slot }, { ids: before.map(r => r.id) })
  return before
}

/** Splits a dish into its rows; returns them as they were (Undo groups them again). */
export async function ungroupMealGroup(groupId: string): Promise<RowPlace[]> {
  const before = await readPlaces({ group: groupId })
  await updateRows({ meal_group_id: null, meal_group_title: null }, { group: groupId })
  return before
}

/** "Move out of meal": the row stays where it is, in no dish. */
export async function moveOutOfGroup(entryId: string): Promise<RowPlace[]> {
  const before = await readPlaces({ ids: [entryId] })
  await updateRows({ meal_group_id: null, meal_group_title: null }, { ids: [entryId] })
  return before
}

/** Puts rows back where they were (the Undo of a move, an ungroup, a "Move out of meal"). */
export async function restorePlaces(places: readonly RowPlace[]): Promise<void> {
  const byPlace = new Map<string, RowPlace[]>()
  for (const p of places) {
    const k = JSON.stringify([p.date, p.meal_slot, p.meal_group_id, p.meal_group_title])
    byPlace.set(k, [...(byPlace.get(k) ?? []), p])
  }
  for (const rows of byPlace.values()) {
    const p = rows[0]
    await updateRows({ date: p.date, meal_slot: p.meal_slot, meal_group_id: p.meal_group_id, meal_group_title: p.meal_group_title }, { ids: rows.map(r => r.id) })
  }
}

/** Renames a dish (null = its automatic name again); returns the name it had. */
export async function renameMealGroup(groupId: string, title: string | null): Promise<string | null> {
  const before = await readPlaces({ group: groupId })
  const user = await requireUser()
  const { error } = await supabase.from('food_log_entries').update({ meal_group_title: title?.trim() || null })
    .eq('user_id', user.id).eq('meal_group_id', groupId)
  if (error) throw isMissingGroupTitle(error) ? new Error(NOT_MIGRATED_158) : error
  return before[0]?.meal_group_title ?? null
}

/** The dish's rows with their names resolved (Edit meal, Copy to), without a taken dose's line. */
export async function fetchMealGroupRows(groupId: string): Promise<LoggedFood[]> {
  const { data, error } = await supabase
    .from('food_log_entries')
    .select('*, ingredient:recipe_ingredient_library(name), recipe:recipes(title)')
    .eq('meal_group_id', groupId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as unknown as (LoggedFood & { ingredient: { name: string } | null; recipe: { title: string } | null })[]
  return rows
    .filter(r => !r.supplement_schedule_id)
    .map(({ ingredient, recipe, ...row }) => ({ ...row, title: ingredient?.name ?? recipe?.title ?? row.custom_title ?? '—' }))
}

/** "Copy to": the dish's rows again on that day and meal, as a dish of their own with the same name. Returns the new ids. */
export async function copyMealGroup(groupId: string, to: { date: string; slot: MealSlot }): Promise<string[]> {
  const rows = await fetchMealGroupRows(groupId)
  if (rows.length === 0) return []
  const newGroup = crypto.randomUUID()
  const entries: FoodLogEntryInput[] = rows.map(r => ({
    date: to.date, meal_slot: to.slot,
    library_ingredient_id: r.library_ingredient_id, recipe_id: r.recipe_id, custom_title: r.custom_title,
    quantity: r.quantity, unit: r.unit,
    calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, fiber_g: r.fiber_g, sugar_g: r.sugar_g,
    meal_group_id: newGroup,
    ...(r.meal_group_title ? { meal_group_title: r.meal_group_title } : {}),
  }))
  return addFoodLogEntries(entries)
}

// ── Edit meal (the logger with the dish in its basket) ──────────────────────

type RowValues = Pick<LoggedFood, 'id' | 'date' | 'meal_slot' | 'quantity' | 'unit' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g'>

export interface DishEditResult {
  /** The kept rows as they were before the save. */
  changed: RowValues[]
  inserted: string[]
  deleted: DeletedRows | null
}

const VALUE_KEYS = ['date', 'meal_slot', 'quantity', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g'] as const

/** What a kept item's row becomes: its amount (and fresh totals for a food or a recipe) in the dish's day and meal. */
function nextValues(it: LogItem, at: { date: string; slot: MealSlot }): Omit<RowValues, 'id'> | Pick<RowValues, 'date' | 'meal_slot'> {
  if (isCustomItem(it)) return { date: at.date, meal_slot: at.slot }
  if (isRecipeItem(it)) return { date: at.date, meal_slot: at.slot, quantity: it.servings, unit: 'serving', ...recipeSnapshot(it.recipe, it.servings) }
  const f = it as BasketItem
  return { date: at.date, meal_slot: at.slot, quantity: f.grams, unit: amountUnit(f.ingredient.unit), ...ingredientSnapshot(f.ingredient, f.grams) }
}

/**
 * Saves an edited dish: kept rows get their new amount (and the dish's meal),
 * new items join the dish, removed rows are deleted (with a snapshot, so the
 * Undo puts them back with the same ids).
 */
export async function saveDishEdit(input: {
  groupId: string
  groupTitle: string | null
  date: string
  slot: MealSlot
  before: readonly LoggedFood[]
  items: readonly LogItem[]
}): Promise<DishEditResult> {
  const user = await requireUser()
  const at = { date: input.date, slot: input.slot }
  const keptIds = new Set(input.items.map(i => i.entryId).filter((x): x is string => !!x))
  const changed: RowValues[] = []
  for (const it of input.items) {
    const row = it.entryId ? input.before.find(r => r.id === it.entryId) : undefined
    if (!row) continue
    const next = nextValues(it, at) as Record<string, unknown>
    if (Object.keys(next).every(k => (row as unknown as Record<string, unknown>)[k] === next[k])) continue
    const { error } = await supabase.from('food_log_entries').update(next).eq('user_id', user.id).eq('id', row.id)
    if (error) throw error
    changed.push(Object.fromEntries([['id', row.id], ...VALUE_KEYS.map(k => [k, row[k]])]) as RowValues)
  }
  const fresh = input.items.filter(i => !i.entryId)
  const inserted = fresh.length
    ? await addFoodLogEntries(itemsToEntries(fresh, { date: input.date, slot: input.slot, groupId: input.groupId, groupTitle: input.groupTitle }))
    : []
  const removed = input.before.filter(r => !keptIds.has(r.id)).map(r => r.id)
  const deleted = removed.length ? await deleteRows('food_log_entries', removed) : null
  return { changed, inserted, deleted }
}

/** The Undo of saveDishEdit: the kept rows as they were, the new ones gone, the removed ones back. */
export async function undoDishEdit(r: DishEditResult): Promise<void> {
  const user = await requireUser()
  for (const row of r.changed) {
    const { id, ...values } = row
    const { error } = await supabase.from('food_log_entries').update(values).eq('user_id', user.id).eq('id', id)
    if (error) throw error
  }
  if (r.inserted.length) await deleteRows('food_log_entries', r.inserted)
  if (r.deleted) await restoreRows(r.deleted)
}
