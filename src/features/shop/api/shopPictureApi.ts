import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

// The memory of which sites gave a product's picture (migration 203's `ai_source_stats`, job 'shop_picture'). Only `shop-price`
// writes the counts (service role, when a picture read was asked for); the browser reads them and may change `state` — nothing else.

export const PICTURE_JOB = 'shop_picture'

export interface PictureSource {
  id: string
  host: string
  ok_count: number
  fail_count: number
  last_ok_at: string | null
  last_fail_at: string | null
  /** Why the last read failed: not_allowed, blocked, no_picture or error. */
  last_reason: string | null
  /** 'ignored': the owner cleared it — it is not used to rank pages until it is put back. */
  state: 'on' | 'ignored'
}

const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /ai_source_stats/.test(e.message ?? ''))

/** The owner's picture sources, best first. A schema from before migration 203 has none (removal: when 203 has run everywhere). */
export async function fetchPictureSources(): Promise<PictureSource[]> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('ai_source_stats')
    .select('id, host, ok_count, fail_count, last_ok_at, last_fail_at, last_reason, state')
    .eq('user_id', user.id)
    .eq('job', PICTURE_JOB)
    .order('ok_count', { ascending: false })
    .limit(200)
  if (error) { if (missingTable(error)) return []; throw error }
  return (data ?? []) as PictureSource[]
}

/** Clears a host (state 'ignored') or puts it back ('on'); the one column the browser may write. */
export async function setPictureSourceState(id: string, state: PictureSource['state']): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('ai_source_stats').update({ state }).eq('id', id).eq('user_id', user.id)
  if (error) throw error
}
