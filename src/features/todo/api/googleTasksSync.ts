import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import type { GoogleTasksSyncSummary } from './googleTasksRules'

// Google → app runs on the server only: the google-tasks-sync edge function
// (every 20 minutes from pg_cron, and on demand from here with the signed-in
// user's JWT) sends the outbox, reads every list (in full once a day or when
// asked, otherwise what changed) and records the outcome in
// google_tasks_sync_state. The browser used to run its own second copy of the
// pull for the Import button; the two had drifted apart (dates, error
// handling), so there is now one.

// The plan editor imports the list resolver from here.
export { resolveOrCreateGoogleTaskListId } from './googleTaskListsApi'

export interface GoogleTasksSyncOptions {
  /** Read every list in full, not only what changed. */
  full?:  boolean
  /** Also retry outbox rows that are waiting out a backoff. */
  force?: boolean
}

/** One run of google-tasks-sync for the signed-in user. Throws with the
 *  function's own error text (e.g. "token refresh failed: invalid_grant"). */
export async function runGoogleTasksSync(opts: GoogleTasksSyncOptions = {}): Promise<GoogleTasksSyncSummary> {
  const { data, error } = await supabase.functions.invoke('google-tasks-sync', { body: opts })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    const message = typeof body?.error === 'string' ? body.error : error.message
    throw new Error(body?.reconnect_required ? `${message} (reconnect Google in Settings → Subscriptions)` : message)
  }
  return (data ?? {}) as GoogleTasksSyncSummary
}

/** google_tasks_sync_state (072, last_full_sync_at since 145): the server's
 *  last run. `updated_at` is the last attempt, whatever its outcome. */
export interface GoogleTasksSyncState {
  last_success_at:    string | null
  last_error:         string | null
  last_error_at:      string | null
  last_full_sync_at?: string | null
  updated_at:         string
}

export async function fetchGoogleTasksSyncState(): Promise<GoogleTasksSyncState | null> {
  // `*`, not a column list: last_full_sync_at only exists once 145 ran.
  const { data, error } = await supabase.from('google_tasks_sync_state').select('*').maybeSingle()
  if (error) throw error
  return (data ?? null) as GoogleTasksSyncState | null
}
