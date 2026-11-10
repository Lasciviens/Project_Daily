import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

/**
 * The Undo of a category just added from a picker's suggestions: whatever was
 * put in it since — or in a subcategory added under it since — moves to its
 * parent (no category for a top), then it goes, and its subcategories with it
 * (the parent link cascades). Every read and write is scoped to the owner's
 * own rows; a category that is already gone is no error (Undo twice).
 */
export async function removeNewCategory(id: string, parentId: string | null): Promise<void> {
  const user = await requireUser()
  const { data: children, error: readError } = await supabase
    .from('shop_categories')
    .select('id')
    .eq('user_id', user.id)
    .eq('parent_id', id)
  if (readError) throw readError
  const ids = [id, ...(children ?? []).map(c => c.id as string)]
  const { error: moveError } = await supabase
    .from('shop_items')
    .update({ category_id: parentId })
    .eq('user_id', user.id)
    .in('category_id', ids)
  if (moveError) throw moveError
  const { error } = await supabase
    .from('shop_categories')
    .delete()
    .eq('user_id', user.id)
    .eq('id', id)
  if (error) throw error
}
