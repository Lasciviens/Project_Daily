import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

/** What the Undo of a category just made did: what went, and how many things moved up. */
export interface RemovedCategory { gone: boolean; moved: number }

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
  const made = Date.parse(createdAt)
  if (Number.isNaN(made) || Date.parse(self.created_at as string) !== made) throw new Error(`${self.name} was there before — nothing was undone`)
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
