import { supabase } from '../../../integrations/supabase/client'
import { readReport, readReports, REPORT_COLUMNS, type AiReport } from './reportRules'

// The weekly report's door (migration 196). `ai_reports` is written only by the `claude` function (service role); the
// browser reads the finished columns of its own rows (never batch_id: the database refuses that column). The two actions
// it asks of the function are in reportActions.ts (kept apart so Home's card, which only reads, stays small).
// Before 196 runs: a read answers empty. Remove the guard once 196 is live.

interface PgError { code?: string; message?: string }
const isMissing = (e: PgError | null): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table/i.test(e.message ?? ''))

/** The reports, newest week first. */
export async function fetchReports(limit = 30): Promise<AiReport[]> {
  const { data, error } = await supabase.from('ai_reports').select(REPORT_COLUMNS).order('week_start', { ascending: false }).order('created_at', { ascending: false }).limit(limit)
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return readReports(data)
}

/** One report by its id; null when it is gone. */
export async function fetchReport(id: string): Promise<AiReport | null> {
  const { data, error } = await supabase.from('ai_reports').select(REPORT_COLUMNS).eq('id', id).maybeSingle()
  if (error) {
    if (isMissing(error)) return null
    throw error
  }
  return readReport(data)
}

/** The newest finished REAL (scheduled) report, for Home's card: a button copy never stands in for it. */
export async function fetchLatestReadyReport(): Promise<AiReport | null> {
  const { data, error } = await supabase.from('ai_reports').select(REPORT_COLUMNS).eq('status', 'ready').eq('made_by', 'schedule')
    .order('week_start', { ascending: false }).order('ready_at', { ascending: false }).limit(1)
  if (error) {
    if (isMissing(error)) return null
    throw error
  }
  return readReports(data)[0] ?? null
}

/** The cost of the reports' ledger rows, by call id (`ai_calls`: the owner reads their own). */
export async function fetchReportCosts(callIds: readonly string[]): Promise<Record<string, { cost_usd: number; outcome: string }>> {
  const ids = callIds.filter(Boolean)
  if (ids.length === 0) return {}
  const { data, error } = await supabase.from('ai_calls').select('id, cost_usd, outcome').in('id', ids)
  if (error) {
    if (isMissing(error)) return {}
    throw error
  }
  const out: Record<string, { cost_usd: number; outcome: string }> = {}
  for (const r of Array.isArray(data) ? data : []) {
    const row = r as { id?: unknown; cost_usd?: unknown; outcome?: unknown }
    const cost = typeof row.cost_usd === 'number' ? row.cost_usd : typeof row.cost_usd === 'string' ? Number(row.cost_usd) : NaN
    if (typeof row.id === 'string') out[row.id] = { cost_usd: Number.isFinite(cost) && cost > 0 ? cost : 0, outcome: typeof row.outcome === 'string' ? row.outcome : '' }
  }
  return out
}
