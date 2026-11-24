import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import { ClaudeJobError } from './claudeApi'

// The owner saved what an AI answer filled (Developer → AI → Learned): the call id and the saved values go to the `claude`
// function, which compares them with its own copy of the answer. Kept apart from learnApi/learnRules so a form that reports
// a save (Food, Settings, Shop, Dev Requests) loads only this.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SaveReport { callId: string; saved: Record<string, string | number | boolean | null>; unticked?: string[]; dismissed?: boolean }

/** A save report checked before it leaves: a uuid call id, at most 200 plain fields, short values. Null when there is nothing to send. */
export function checkedSaveReport(r: SaveReport | null | undefined): SaveReport | null {
  if (!r || typeof r.callId !== 'string' || !UUID.test(r.callId)) return null
  const saved: SaveReport['saved'] = {}
  for (const [k, v] of Object.entries(r.saved ?? {}).slice(0, 200)) {
    if (!/^[a-z_]{1,40}(\.[0-9]{1,3}\.[a-z_]{1,40})?$/.test(k)) continue
    if (typeof v === 'string' ? v.length <= 2000 : v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) saved[k] = v
  }
  const unticked = (r.unticked ?? []).filter(f => /^[a-z_]{1,40}(\.[0-9]{1,3}\.[a-z_]{1,40})?$/.test(f)).slice(0, 200)
  return { callId: r.callId, saved, unticked, dismissed: r.dismissed === true }
}

/** One request to the `claude` function; a failure is a ClaudeJobError with a plain sentence. */
export async function callLearnFunction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('claude', { body })
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status
    if (status === 401 || status === 403) throw new ClaudeJobError('error', 'Session error — refresh the page and sign in again.')
    const said = await parseFunctionErrorBody(error)
    throw new ClaudeJobError('error', (typeof said?.message === 'string' && said.message.trim().slice(0, 300)) || 'The AI function didn’t answer — try again in a moment.')
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
}

export const learnSaid = (data: Record<string, unknown>, fallback: string): string => (typeof data.message === 'string' ? data.message.slice(0, 300) : fallback)

/** The owner saved what an AI answer filled: the call id and the saved values only (the function compares them with its own copy). Several saves go as one request. */
export async function reportAiSave(report: SaveReport | readonly SaveReport[]): Promise<number> {
  const list = (Array.isArray(report) ? report : [report]).map(checkedSaveReport).filter((r): r is SaveReport => r !== null).slice(0, 50)
  if (!list.length) return 0
  const one = (r: SaveReport) => ({ call_id: r.callId, saved: r.saved, unticked: r.unticked, dismissed: r.dismissed })
  const data = await callLearnFunction(list.length === 1 ? { action: 'learn_save', ...one(list[0]) } : { action: 'learn_save', reports: list.map(one) })
  if (data.ok !== true) throw new Error(learnSaid(data, 'The save could not be noted for learning.'))
  return typeof data.recorded === 'number' ? data.recorded : 0
}
