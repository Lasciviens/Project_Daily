import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { optionsToJson, parseGuessOptions, type QuickGuessInput, type QuickGuessItem } from '../quickGuess'

// quick_guess_items (migration 152): the Quick guess presets, edited in
// Settings → Food. The website can meet a database without 152 (a failed
// migration, a revert): a READ then answers null and the card shows the
// built-in presets; a WRITE throws an error naming the migration. The guard
// can go once 152 has run on every database the site talks to.
// Its options column (migration 159) has the same kind of guard: without it a
// read retries without the column (every preset then has no options), a write
// without options retries without it, and a write WITH options throws an
// error naming 159. That guard can go once 159 has run everywhere.

const NOT_MIGRATED_152 = "Quick guess presets can't be saved yet — migration 152 (quick_guess_items) has not been applied."
const NOT_MIGRATED_159 = "Quick guess options can't be saved yet — migration 159 (quick_guess_items.options) has not been applied."

const BASE_COLUMNS = 'id, name, icon, portion, calories, protein_g, carbs_g, fat_g, sugar_g, sort_order'
const COLUMNS = `${BASE_COLUMNS}, options`

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

/** The database answered "no options column" (before migration 159). */
function isMissingOptions(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /options/i.test(x?.message ?? '')
}

function writeError(e: unknown): Error {
  return isMissingTable(e) ? new Error(NOT_MIGRATED_152) : (e as Error)
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// A row as the database answers it; numerics and the options' shape are checked here, where they enter.
function toItem(r: Record<string, unknown>): QuickGuessItem {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    icon: typeof r.icon === 'string' && r.icon ? r.icon : null,
    portion: typeof r.portion === 'string' && r.portion ? r.portion : null,
    calories: num(r.calories),
    protein_g: num(r.protein_g),
    carbs_g: num(r.carbs_g),
    fat_g: num(r.fat_g),
    sugar_g: num(r.sugar_g),
    sort_order: num(r.sort_order),
    options: parseGuessOptions(r.options),
  }
}

/** The row as the table takes it: the options as their stored jsonb. */
function toRow(input: Partial<QuickGuessInput>): Record<string, unknown> {
  const { options, ...rest } = input
  return options === undefined ? rest : { ...rest, options: optionsToJson(options) }
}

type Answer = PromiseLike<{ data: unknown; error: unknown }>

/**
 * One write with the options column, retried once without it on a database
 * before 159 — unless the write has options to save; then it says so.
 */
async function writeWithOptions(input: Partial<QuickGuessInput>, run: (row: Record<string, unknown>, columns: string) => Answer): Promise<QuickGuessItem> {
  const first = await run(toRow(input), COLUMNS)
  if (!first.error) return toItem(first.data as Record<string, unknown>)
  if (!isMissingOptions(first.error)) throw writeError(first.error)
  if (input.options?.length) throw new Error(NOT_MIGRATED_159)
  const without = { ...input }
  delete without.options
  const retry = await run(toRow(without), BASE_COLUMNS)
  if (retry.error) throw writeError(retry.error)
  return toItem(retry.data as Record<string, unknown>)
}

/** The owner's presets in their order, or null before migration 152. */
export async function fetchQuickGuessItems(): Promise<QuickGuessItem[] | null> {
  const read = (columns: string) => supabase
    .from('quick_guess_items')
    .select(columns)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  let { data, error } = await read(COLUMNS)
  if (error && isMissingOptions(error)) ({ data, error } = await read(BASE_COLUMNS))
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toItem)
}

export async function createQuickGuessItem(input: QuickGuessInput): Promise<QuickGuessItem> {
  return writeWithOptions(input, (row, columns) => supabase.from('quick_guess_items').insert(row).select(columns).single())
}

export async function updateQuickGuessItem(id: string, patch: Partial<QuickGuessInput>): Promise<QuickGuessItem> {
  const user = await requireUser()
  return writeWithOptions(patch, (row, columns) => supabase
    .from('quick_guess_items')
    .update(row)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(columns)
    .single())
}

/** Writes new places (quickGuess.moveGuess gives the rows that change). */
export async function reorderQuickGuessItems(changes: readonly { id: string; sort_order: number }[]): Promise<void> {
  const user = await requireUser()
  const results = await Promise.all(changes.map(c => supabase
    .from('quick_guess_items')
    .update({ sort_order: c.sort_order })
    .eq('id', c.id)
    .eq('user_id', user.id)))
  const failed = results.find(r => r.error)
  if (failed?.error) throw writeError(failed.error)
}
