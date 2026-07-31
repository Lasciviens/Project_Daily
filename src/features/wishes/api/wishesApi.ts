import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { WishItem, CreateWishInput, UpdateWishInput } from '../types'

// wish_items (migration 069) may not be applied yet — the user defers every
// migration step. The READ path degrades to an empty list so no surface breaks
// on an un-migrated DB (same guard as waterApi.ts). A WRITE, by contrast, must
// NOT be a silent no-op: that would look exactly like data loss, so it throws a
// message naming the missing migration.

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

const NOT_MIGRATED = 'Wishes are not available yet — migration 069 (wish_items) has not been applied.'

export async function fetchWishes(): Promise<WishItem[]> {
  const { data, error } = await supabase
    .from('wish_items')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return data ?? []
}

export async function createWish(input: CreateWishInput): Promise<WishItem> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('wish_items')
    .insert({
      user_id:      user.id,
      title:        input.title,
      notes:        input.notes ?? null,
      kind:         input.kind ?? 'thing',
      period_start: input.period_start ?? null,
      period_end:   input.period_end ?? null,
      period_label: input.period_label ?? null,
      city:         input.city ?? null,
      country:      input.country ?? null,
      url:          input.url ?? null,
      priority:     input.priority ?? 'medium',
    })
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  return data
}

export async function updateWish(id: string, patch: UpdateWishInput): Promise<void> {
  const { error } = await supabase
    .from('wish_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}

export async function deleteWish(id: string): Promise<void> {
  const { error } = await supabase.from('wish_items').delete().eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}
