import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

// The server's notices for the Shop (211's `notifications`, written only by the database): "a plan bought this thing
// — check the purchase". The browser reads them and sets read_at, nothing else. A database before 211 has no table:
// none (a missing-table guard, never an error).

export interface ShopNotice {
  id: string
  kind: 'shop_bought_draft'
  link_kind: 'shop_item'
  link_id: string
  created_at: string
}

const isMissingTable = (e: { code?: string } | null) => !!e && ['42P01', 'PGRST205', 'PGRST202'].includes(e.code ?? '')

/** The unread Shop notices, newest first. */
export async function fetchShopNotices(): Promise<ShopNotice[]> {
  const { data, error } = await supabase.from('notifications')
    .select('id, kind, link_kind, link_id, created_at')
    .eq('kind', 'shop_bought_draft').is('read_at', null)
    .order('created_at', { ascending: false }).limit(200)
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  // Only what the screen can show: a thing the notice names by its kind (a row is the server's, still checked here).
  return ((data ?? []) as ShopNotice[]).filter(n => n.kind === 'shop_bought_draft' && n.link_kind === 'shop_item' && typeof n.link_id === 'string')
}

/** Put a notice away (read) or back (unread, its Undo). */
export async function setNoticeRead(id: string, read: boolean): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('notifications')
    .update({ read_at: read ? new Date().toISOString() : null }).eq('id', id).eq('user_id', user.id)
  if (error) throw error
}
