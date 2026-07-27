import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'

// Recent activity for one project — reads the existing audit_logs table
// (migration 037, written by DB triggers) filtered to this project's own
// rows plus its phases/items. No new table needed.

interface AuditLog {
  id:         string
  table_name: string
  operation:  'INSERT' | 'UPDATE' | 'DELETE'
  new_data:   Record<string, unknown> | null
  old_data:   Record<string, unknown> | null
  created_at: string
}

const OP_LABEL: Record<AuditLog['operation'], string> = {
  INSERT: 'added',
  UPDATE: 'updated',
  DELETE: 'removed',
}

const OP_DOT: Record<AuditLog['operation'], string> = {
  INSERT: 'bg-emerald-400',
  UPDATE: 'bg-accent-400',
  DELETE: 'bg-red-400',
}

function rowLabel(log: AuditLog): string {
  const d = log.new_data ?? log.old_data ?? {}
  const v = d['title'] ?? d['name']
  return typeof v === 'string' && v.trim() ? v : '—'
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function useProjectActivity(projectId: string, itemIds: string[], phaseIds: string[]) {
  return useQuery<AuditLog[]>({
    queryKey: ['project-activity', projectId, itemIds.length, phaseIds.length],
    queryFn: async () => {
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
    },
    staleTime: 30_000,
  })
}

export function ProjectActivityFeed({ projectId, itemIds, phaseIds }: { projectId: string; itemIds: string[]; phaseIds: string[] }) {
  const { data: logs = [], isLoading } = useProjectActivity(projectId, itemIds, phaseIds)

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 flex flex-col gap-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Activity</span>
      {isLoading ? (
        <div className="h-16 rounded-xl bg-cream-100 animate-pulse" />
      ) : logs.length === 0 ? (
        <p className="text-xs text-ink-500 py-2">No recent activity yet.</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto">
          {logs.map(log => (
            <div key={log.id} className="flex items-start gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${OP_DOT[log.operation]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-ink-700 truncate">
                  <span className="font-medium">{rowLabel(log)}</span> {OP_LABEL[log.operation]}
                </p>
                <p className="text-[10px] text-ink-500">{fmtWhen(log.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
