import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import { ClaudeJobError } from './claudeApi'
import {
  readSuggestions, readSuggestRuns, SUGGEST_RUN_COLUMNS, SUGGESTION_COLUMNS, suggestMakeMessage,
  type AiSuggestion, type AiSuggestRun, type SuggestionState,
} from './suggestRules'

// The suggestions' door (migration 199). `ai_suggestions` is written only by the `claude` function (service role): the browser
// reads its own rows and may change ONE column, `state` (the database refuses every other). The weekly look's own table is
// read the same way (never its batch id). Before 199 runs: a read answers empty and a write names the migration.
// Remove the guards once 199 is live.

const NOT_MIGRATED_199 = 'Suggestions are not available yet — migration 199 (ai_suggestions) has not been applied.'

interface PgError { code?: string; message?: string }
const isMissing = (e: PgError | null): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table/i.test(e.message ?? ''))

/** The ideas, newest first (a few hundred at most: the database holds 300 per account). */
export async function fetchSuggestions(): Promise<AiSuggestion[]> {
  const { data, error } = await supabase.from('ai_suggestions').select(SUGGESTION_COLUMNS).order('created_at', { ascending: false }).limit(300)
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  const list = readSuggestions(data)
  // The answer each one came from: the ledger run of its first call (read in small groups: a long list of ids does not fit in an address).
  const ids = [...new Set(list.map(s => s.first_call_id).filter((id): id is string => !!id))]
  const runs = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 40) {
    const { data: calls, error: callsError } = await supabase.from('ai_calls').select('id, run_id').in('id', ids.slice(i, i + 40))
    if (callsError) break // the cards simply have no link
    for (const c of Array.isArray(calls) ? calls : []) {
      const row = c as { id?: unknown; run_id?: unknown }
      if (typeof row.id === 'string' && typeof row.run_id === 'string') runs.set(row.id, row.run_id)
    }
  }
  return list.map(s => (s.first_call_id && runs.has(s.first_call_id) ? { ...s, run_id: runs.get(s.first_call_id) as string } : s))
}

/** The last few runs of the weekly look. */
export async function fetchSuggestRuns(): Promise<AiSuggestRun[]> {
  const { data, error } = await supabase.from('ai_suggest_runs').select(SUGGEST_RUN_COLUMNS).order('created_at', { ascending: false }).limit(5)
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return readSuggestRuns(data)
}

/** Keeps, dismisses, marks built, or brings back an idea: the one thing the browser may change. */
export async function setSuggestionState(id: string, state: SuggestionState): Promise<SuggestionState> {
  const user = await requireUser()
  const { data, error } = await supabase.from('ai_suggestions').update({ state }).eq('id', id).eq('user_id', user.id).select('id')
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_199) : error
  if (!Array.isArray(data) || data.length !== 1) throw new Error('That idea is not in your list any more.')
  return state
}

/** "Look for ideas now": the function counts the repeats and queues the weekly look. Throws the function's own sentence when nothing was queued. */
export async function lookForIdeasNow(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('claude', { body: { action: 'suggest_make' } })
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status
    if (status === 401 || status === 403) throw new ClaudeJobError('error', 'Session error — refresh the page and sign in again.')
    const body = await parseFunctionErrorBody(error)
    throw new ClaudeJobError('error', (typeof body?.message === 'string' && body.message.trim().slice(0, 300)) || 'The AI function didn’t answer — try again in a moment.')
  }
  const said = suggestMakeMessage(data)
  if (!said.ok) throw new Error(said.message)
  return said.message
}
