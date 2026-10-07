import { supabase } from '../../../integrations/supabase/client'

// Merges two retro copies of one game in ONE database transaction:
// `merge_games` (migration 131). The rules — and the preview the popup shows —
// live in test-game/tgMergeModel.ts; the function applies the same rules.

export interface MergeResult {
  kept: string
  removed: string
  moved_platforms: number
  took_screenscraper: boolean
  moved_scrape_record: boolean
  took_igdb: boolean
}

const NOT_MIGRATED = 'Merging is not set up yet (migration 131 not applied)'

/** PostgREST's "no such function" answers (before 131). */
function isMissingFunction(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false
  return e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? '')
}

export async function mergeGames(keepId: string, dropId: string): Promise<MergeResult> {
  const { data, error } = await supabase.rpc('merge_games', { keep_id: keepId, drop_id: dropId })
  if (error) throw isMissingFunction(error) ? new Error(NOT_MIGRATED) : new Error(error.message.replace(/^merge_games:\s*/, ''))
  return data as MergeResult
}
