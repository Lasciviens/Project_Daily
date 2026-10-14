import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { QuickGuessInput, QuickGuessItem } from '../quickGuess'

// quick_guess_items (migration 152): the Quick guess presets, edited in
// Settings → Food. The website can meet a database without 152 (a failed
// migration, a revert): a READ then answers null and the card shows the
// built-in presets; a WRITE throws an error naming the migration. The guard
// can go once 152 has run on every database the site talks to.

const NOT_MIGRATED_152 = "Quick guess presets can't be saved yet — migration 152 (quick_guess_items) has not been applied."

const COLUMNS = 'id, name, icon, portion, calories, protein_g, carbs_g, fat_g, sugar_g, sort_order'

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

function writeError(e: unknown): Error {
  return isMissingTable(e) ? new Error(NOT_MIGRATED_152) : (e as Error)
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// A row as the database answers it; numerics are checked here, where they enter.
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
  }
}

/** The owner's presets in their order, or null before migration 152. */
export async function fetchQuickGuessItems(): Promise<QuickGuessItem[] | null> {
  const { data, error } = await supabase
    .from('quick_guess_items')
    .select(COLUMNS)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toItem)
}

export async function createQuickGuessItem(input: QuickGuessInput): Promise<QuickGuessItem> {
  const { data, error } = await supabase.from('quick_guess_items').insert(input).select(COLUMNS).single()
  if (error) throw writeError(error)
  return toItem(data as Record<string, unknown>)
}

export async function updateQuickGuessItem(id: string, patch: Partial<QuickGuessInput>): Promise<QuickGuessItem> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('quick_guess_items')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(COLUMNS)
    .single()
  if (error) throw writeError(error)
  return toItem(data as Record<string, unknown>)
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
