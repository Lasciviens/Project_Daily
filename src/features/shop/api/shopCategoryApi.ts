import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { suggestedPlan } from '../shopTaxonomy'
import type { ShopCategory } from '../types'
import { allPages } from './shopApi'

/** What the Undo of a category just made did: what went, and how many things moved up. */
export interface RemovedCategory { gone: boolean; moved: number }

/**
 * The Undo's guard: the row is still the one that was made — its own `created_at`, to the millisecond, never
 * an older category under the same id. Both Undos below refuse a row that isn't.
 */
function isTheOneMade(rowCreatedAt: string, createdAt: string): boolean {
  const made = Date.parse(createdAt)
  return !Number.isNaN(made) && Date.parse(rowCreatedAt) === made
}

/**
 * The Undo of a category just made from a picker's suggestion (`createdAt`: the made row's own time): whatever
 * was put in it since — or in a subcategory made under it since — moves to its parent (no category for a top),
 * then it goes, and its subcategories with it (the parent link cascades). It refuses before any write when the
 * row isn't the one that was made, or holds a subcategory older than it — "… was there before — nothing was
 * undone": the cascade would take that one too. Every read and write is scoped to the owner's own rows; a
 * category that is already gone is no error (Undo twice).
 */
export async function removeNewCategory(id: string, parentId: string | null, createdAt: string): Promise<RemovedCategory> {
  const user = await requireUser()
  const { data: self, error: selfError } = await supabase
    .from('shop_categories')
    .select('id, name, created_at')
    .eq('user_id', user.id)
    .eq('id', id)
    .maybeSingle()
  if (selfError) throw selfError
  if (!self) return { gone: false, moved: 0 }
  if (!isTheOneMade(self.created_at as string, createdAt)) throw new Error(`${self.name} was there before — nothing was undone`)
  const made = Date.parse(createdAt)
  const { data: children, error: readError } = await supabase
    .from('shop_categories')
    .select('id, name, created_at')
    .eq('user_id', user.id)
    .eq('parent_id', id)
  if (readError) throw readError
  const older = (children ?? []).find(c => !(Date.parse(c.created_at as string) >= made))
  if (older) throw new Error(`${older.name} was there before — nothing was undone`)
  const ids = [id, ...(children ?? []).map(c => c.id as string)]
  const { data: moved, error: moveError } = await supabase
    .from('shop_items')
    .update({ category_id: parentId })
    .eq('user_id', user.id)
    .in('category_id', ids)
    .select('id')
  if (moveError) throw moveError
  const { error } = await supabase
    .from('shop_categories')
    .delete()
    .eq('user_id', user.id)
    .eq('id', id)
  if (error) throw error
  return { gone: true, moved: moved?.length ?? 0 }
}

// ── Add the suggested categories (owner, 10.11.2026) ─────────────────────────

const CATEGORY_COLUMNS = 'id, user_id, name, parent_id, created_at'
/** Ids per `in` filter, so a request's address stays short (the taxonomy is about a hundred rows). */
const IDS_PER_REQUEST = 100

const inParts = (ids: readonly string[]) =>
  Array.from({ length: Math.ceil(ids.length / IDS_PER_REQUEST) }, (_, i) => ids.slice(i * IDS_PER_REQUEST, (i + 1) * IDS_PER_REQUEST))

async function insertCategories(rows: { user_id: string; name: string; parent_id: string | null }[]): Promise<ShopCategory[]> {
  if (!rows.length) return []
  const { data, error } = await supabase.from('shop_categories').insert(rows).select(CATEGORY_COLUMNS)
  if (error) throw error
  return (data ?? []) as ShopCategory[]
}

/**
 * "Add the suggested categories": every suggestion a picker offers, made in two writes — the top categories,
 * then every subcategory (under them and under the owner's own tops) — and answered as the rows made, tops
 * first (the Undo's list). The plan is worked out from a fresh read of the owner's own rows (`suggestedPlan`),
 * so a name the owner has by now under any of its names is never made twice; none to make is no write at all.
 * When the subcategories can't be written, the tops just made are taken back (the Undo's own guard) before the
 * error goes up — never half a list left behind.
 */
export async function addSuggestedCategories(): Promise<ShopCategory[]> {
  const user = await requireUser()
  const own = await allPages<ShopCategory>((from, to) => supabase
    .from('shop_categories')
    .select(CATEGORY_COLUMNS)
    .eq('user_id', user.id)
    .order('id', { ascending: true })
    .range(from, to))
  const plan = suggestedPlan(own)
  if (!plan.count) return []
  const tops = await insertCategories(plan.tops.map(t => ({ user_id: user.id, name: t.name, parent_id: null })))
  const topId = new Map(tops.filter(t => !t.parent_id).map(t => [t.name, t.id]))
  try {
    if (plan.tops.some(t => !topId.has(t.name))) throw new Error('The new categories didn\'t come back — nothing was added')
    const subs = await insertCategories([
      ...plan.under.flatMap(u => u.subs.map(name => ({ user_id: user.id, name, parent_id: u.parentId }))),
      ...plan.tops.flatMap(t => t.subs.map(name => ({ user_id: user.id, name, parent_id: topId.get(t.name) as string }))),
    ])
    return [...tops, ...subs]
  } catch (e) {
    await removeAddedCategories(tops).catch(() => undefined)
    throw e
  }
}

/** A row as "Add the suggested categories" made it (the write's own answer): what its Undo compares. */
type MadeCategory = Pick<ShopCategory, 'id' | 'name' | 'parent_id' | 'created_at'>

/** Why the Undo kept a row it made: something is in it now, it was renamed or moved, or it isn't the row it made. */
export type KeptWhy = 'in_use' | 'changed' | 'before'
/** What the Undo of "Add the suggested categories" did: the ids removed, how many were gone already, what stays. */
export interface RemovedAdded { removed: string[]; gone: number; kept: { name: string; why: KeptWhy }[] }

/**
 * The Undo of "Add the suggested categories": removes exactly the rows it made (`made`, as the write answered
 * them), and of those only the ones still as it made them — the same row (`isTheOneMade`), the same name and
 * place, nothing in it, and nothing under it but rows it made that go too (a subcategory of the owner's, older
 * or newer, keeps its top: the cascade would take it). It never moves a thing or touches another row; what it
 * keeps it names (`undoneWords`). Every read and write is scoped to the owner's own rows; a row already gone is
 * no error (Undo twice).
 */
export async function removeAddedCategories(made: readonly MadeCategory[]): Promise<RemovedAdded> {
  const user = await requireUser()
  const ids = made.map(m => m.id)
  const rows: MadeCategory[] = []
  const children: Pick<ShopCategory, 'id' | 'parent_id'>[] = []
  const holding = new Set<string>()
  for (const part of inParts(ids)) {
    rows.push(...await allPages<MadeCategory>((from, to) => supabase
      .from('shop_categories').select('id, name, parent_id, created_at').eq('user_id', user.id).in('id', part)
      .order('id', { ascending: true }).range(from, to)))
    children.push(...await allPages<Pick<ShopCategory, 'id' | 'parent_id'>>((from, to) => supabase
      .from('shop_categories').select('id, parent_id').eq('user_id', user.id).in('parent_id', part)
      .order('id', { ascending: true }).range(from, to)))
    const used = await allPages<{ category_id: string }>((from, to) => supabase
      .from('shop_items').select('id, category_id').eq('user_id', user.id).in('category_id', part)
      .order('id', { ascending: true }).range(from, to))
    for (const i of used) holding.add(i.category_id)
  }
  const now = new Map(rows.map(r => [r.id, r]))
  const removed = new Set<string>()
  const kept: RemovedAdded['kept'] = []
  let gone = 0
  // Subcategories first: a top goes only when everything under it goes.
  for (const m of [...made].sort((a, b) => Number(!a.parent_id) - Number(!b.parent_id))) {
    const row = now.get(m.id)
    if (!row) { gone++; continue }
    const why: KeptWhy | null = !isTheOneMade(row.created_at, m.created_at) ? 'before'
      : row.name !== m.name || (row.parent_id ?? null) !== (m.parent_id ?? null) ? 'changed'
      : holding.has(m.id) || children.some(c => c.parent_id === m.id && !removed.has(c.id)) ? 'in_use'
      : null
    if (why) kept.push({ name: row.name, why })
    else removed.add(m.id)
  }
  for (const part of inParts([...removed])) {
    const { error } = await supabase.from('shop_categories').delete().eq('user_id', user.id).in('id', part)
    if (error) throw error
  }
  return { removed: [...removed], gone, kept }
}

const categories = (n: number) => `${n} ${n === 1 ? 'category' : 'categories'}`

/** "34 categories added". */
export const addedWords = (n: number) => `${categories(n)} added`

/** "32 categories removed · 2 kept, in use now: Phones, Electronics" — what the Undo did, and what it couldn't. */
export function undoneWords(r: RemovedAdded): string {
  if (!r.removed.length && !r.kept.length) return 'The categories were already gone'
  const head = r.removed.length ? `${categories(r.removed.length)} removed` : 'Nothing removed'
  if (!r.kept.length) return head
  const whys = new Set(r.kept.map(k => k.why))
  const why = whys.size > 1 ? 'in use or changed since' : whys.has('in_use') ? 'in use now' : whys.has('changed') ? 'changed since' : 'there before'
  const names = r.kept.length <= 3 ? r.kept.map(k => k.name).join(', ') : `${r.kept.slice(0, 2).map(k => k.name).join(', ')} + ${r.kept.length - 2} more`
  return `${head} · ${r.kept.length} kept, ${why}: ${names}`
}
