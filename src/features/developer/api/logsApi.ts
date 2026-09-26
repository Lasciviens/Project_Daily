import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

// Developer → Errors / Activity and the project activity feed. The only
// place app_error_logs and audit_logs (migration 037, trigger-written) are read.

export interface ErrorLog {
  id:         string
  message:    string
  context:    Record<string, unknown> | null
  created_at: string
}

export interface AuditLog {
  id:         string
  table_name: string
  operation:  'INSERT' | 'UPDATE' | 'DELETE'
  row_id:     string | null
  old_data:   Record<string, unknown> | null
  new_data:   Record<string, unknown> | null
  actor:      'web' | 'service'
  tx_id:      number
  created_at: string
}

/** Errors from the last `days` days, newest first (max 100). */
export async function fetchErrorLogs(days = 2): Promise<ErrorLog[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('app_error_logs')
    .select('id, message, context, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as ErrorLog[]
}

export async function clearErrorLogs(): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('app_error_logs').delete().eq('user_id', user.id)
  if (error) throw error
}

export interface AuditLogFilter {
  /** Relative window in hours, used when neither custom bound is set. */
  rangeHours: number
  /** datetime-local strings; either one switches to the custom window. */
  customFrom?: string
  customTo?: string
}

/** Audit rows for a window, newest first (max 500). Dates resolve at call time. */
export async function fetchAuditLogs({ rangeHours, customFrom = '', customTo = '' }: AuditLogFilter): Promise<AuditLog[]> {
  const usingCustom = !!(customFrom || customTo)
  const fromIso = usingCustom
    ? (customFrom ? new Date(customFrom).toISOString() : new Date(0).toISOString())
    : new Date(Date.now() - rangeHours * 60 * 60 * 1000).toISOString()
  const toIso = usingCustom && customTo ? new Date(customTo).toISOString() : null
  let q = supabase.from('audit_logs').select('*').gte('created_at', fromIso)
  if (toIso) q = q.lte('created_at', toIso)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
  if (error) throw error
  return (data ?? []) as AuditLog[]
}

export async function clearAuditLogs(): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('audit_logs').delete().eq('user_id', user.id)
  if (error) throw error
}

/** The last 30 audit rows touching one project, its phases or its items. */
export async function fetchProjectActivity(projectId: string, itemIds: string[], phaseIds: string[]): Promise<AuditLog[]> {
  const [itemsRes, phasesRes, projectRes] = await Promise.all([
    itemIds.length
      ? supabase.from('audit_logs').select('*').eq('table_name', 'project_items').in('row_id', itemIds)
      : Promise.resolve({ data: [], error: null }),
    phaseIds.length
      ? supabase.from('audit_logs').select('*').eq('table_name', 'project_phases').in('row_id', phaseIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('audit_logs').select('*').eq('table_name', 'projects').eq('row_id', projectId),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (phasesRes.error) throw phasesRes.error
  if (projectRes.error) throw projectRes.error
  const all = [...(itemsRes.data ?? []), ...(phasesRes.data ?? []), ...(projectRes.data ?? [])] as AuditLog[]
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30)
}
