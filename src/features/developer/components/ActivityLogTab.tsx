import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'

// CRUD audit trail (audit_logs table, written by DB triggers — see migration
// 037). Shows every insert/update/delete on user-authored tables, whoever
// made it (web UI, Ask AI, edge functions), grouped by transaction so
// cascades ("this delete also removed those") read as one connected event.
//
// Layout: a 4-column matrix (grid-cols-4 on wide screens) rather than one
// long vertical list — there's plenty of horizontal room on this page and a
// flat list buries same-transaction cascades among unrelated entries. A
// group sharing one tx_id (e.g. deleting a time_block that migration 043's
// trigger also cascades into deleting its linked task) spans multiple grid
// columns as a single connected strip with a directional arrow between each
// step, so "this caused that" reads visually instead of needing to mentally
// correlate timestamps across separate rows.

interface AuditLog {
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

const OP_DOT: Record<AuditLog['operation'], string> = {
  INSERT: 'bg-emerald-400',
  UPDATE: 'bg-accent-400',
  DELETE: 'bg-red-400',
}

const OP_LABEL: Record<AuditLog['operation'], string> = {
  INSERT: 'created',
  UPDATE: 'updated',
  DELETE: 'deleted',
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// Best-effort human label for the affected row.
function rowLabel(log: AuditLog): string {
  const d = log.new_data ?? log.old_data ?? {}
  for (const key of ['title', 'name', 'label', 'message']) {
    const v = d[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  return log.row_id ? `#${log.row_id.slice(0, 8)}` : '—'
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function useAuditLogs(days: number) {
  return useQuery<AuditLog[]>({
    queryKey: ['audit-logs', days],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as AuditLog[]
    },
    staleTime: 30_000,
  })
}

function useClearAuditLogs() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'clear_audit_logs',
    successMessage: 'Activity log cleared ✓',
    mutationFn: async () => {
      const user = await requireUser()
      const { error } = await supabase.from('audit_logs').delete().eq('user_id', user.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-logs'] }),
  })
}

// UPDATE → changed keys side by side; INSERT/DELETE → the full row snapshot.
function DiffView({ log }: { log: AuditLog }) {
  if (log.operation === 'UPDATE') {
    const keys = [...new Set([
      ...Object.keys(log.old_data ?? {}),
      ...Object.keys(log.new_data ?? {}),
    ])].sort()
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">
              <th className="text-left py-1 pr-3">Field</th>
              <th className="text-left py-1 pr-3">Before</th>
              <th className="text-left py-1">After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {keys.map(k => (
              <tr key={k}>
                <td className="py-1 pr-3 font-medium text-ink-600 whitespace-nowrap align-top">{k}</td>
                <td className="py-1 pr-3 text-red-500 break-all align-top">{fmtValue(log.old_data?.[k])}</td>
                <td className="py-1 text-emerald-600 break-all align-top">{fmtValue(log.new_data?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  const data = log.operation === 'DELETE' ? log.old_data : log.new_data
  return (
    <pre className="text-xs text-ink-700 overflow-x-auto whitespace-pre-wrap break-words">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

// One compact card — used both standalone (grid cell) and inside a cascade
// chain (flex item connected by arrows to its neighbors).
function LogCard({ log, expanded, onToggle }: { log: AuditLog; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white overflow-hidden flex-1 min-w-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex flex-col items-start gap-1 px-3 py-2.5 min-h-[44px] text-left hover:bg-cream-50 transition-colors"
      >
        <div className="flex items-center gap-1.5 w-full">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${OP_DOT[log.operation]}`} />
          <span className="text-xs font-medium text-ink-500 truncate">{log.table_name}</span>
          <span className="text-[10px] text-ink-400 flex-shrink-0">{OP_LABEL[log.operation]}</span>
          <span className={`ml-auto text-[9px] font-medium rounded-full px-1.5 py-0.5 flex-shrink-0 ${
            log.actor === 'web' ? 'bg-ink-100 text-ink-500' : 'bg-accent-100 text-accent-700'
          }`}>
            {log.actor === 'web' ? 'me' : 'service'}
          </span>
        </div>
        <p className="text-sm text-ink-800 truncate w-full">{rowLabel(log)}</p>
        <div className="flex items-center justify-between w-full">
          <span className="text-[10px] text-ink-400">{fmtDate(log.created_at)}</span>
          <span className="text-[10px] text-ink-300">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-ink-100 bg-ink-50 px-3 py-2">
          <DiffView log={log} />
        </div>
      )}
    </div>
  )
}

// A same-transaction group of >1 changes — rendered as a connected chain
// with a directional arrow between each step (the order they were written
// in, which for a trigger-caused cascade is "the direct change" first,
// followed by whatever it triggered).
function CascadeChain({ group, expandedId, onToggle }: { group: AuditLog[]; expandedId: string | null; onToggle: (id: string) => void }) {
  return (
    <div
      className="rounded-xl border border-accent-200 bg-accent-50/40 p-2 flex flex-col gap-1"
      style={{ gridColumn: `span ${Math.min(group.length, 4)} / span ${Math.min(group.length, 4)}` }}
    >
      <p className="text-[10px] font-semibold text-accent-600 uppercase tracking-wide px-1">
        Linked — same transaction, {group.length} changes
      </p>
      <div className="flex items-stretch gap-1.5 flex-wrap">
        {group.map((log, i) => (
          <div key={log.id} className="flex items-stretch gap-1.5 flex-1 min-w-[160px]">
            <LogCard log={log} expanded={expandedId === log.id} onToggle={() => onToggle(log.id)} />
            {i < group.length - 1 && (
              <span className="flex items-center text-accent-400 text-lg leading-none flex-shrink-0" title="triggered">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ActivityLogTab() {
  const [days, setDays] = useState(7)
  const [tableFilter, setTableFilter] = useState('all')
  const [opFilter, setOpFilter] = useState('all')
  const [actorFilter, setActorFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: logs = [], isLoading, error, refetch } = useAuditLogs(days)
  const clearLogs = useClearAuditLogs()

  const tables = useMemo(() => [...new Set(logs.map(l => l.table_name))].sort(), [logs])

  const filtered = useMemo(() => logs.filter(l =>
    (tableFilter === 'all' || l.table_name === tableFilter) &&
    (opFilter === 'all' || l.operation === opFilter) &&
    (actorFilter === 'all' || l.actor === actorFilter)
  ), [logs, tableFilter, opFilter, actorFilter])

  // Consecutive rows sharing a tx_id changed in the same transaction — render
  // them as one connected chain so cascades read as a single linked event.
  const groups = useMemo(() => {
    const out: AuditLog[][] = []
    for (const log of filtered) {
      const last = out[out.length - 1]
      if (last && last[0].tx_id === log.tx_id) last.push(log)
      else out.push([log])
    }
    return out
  }, [filtered])

  const selectCls = 'min-h-[44px] text-xs border border-ink-200 rounded-lg px-2 bg-white text-ink-700'
  const toggle = (id: string) => setExpanded(e => e === id ? null : id)

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <select value={tableFilter} onChange={e => setTableFilter(e.target.value)} className={selectCls}>
            <option value="all">All tables</option>
            {tables.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={opFilter} onChange={e => setOpFilter(e.target.value)} className={selectCls}>
            <option value="all">All operations</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
          </select>
          <select value={actorFilter} onChange={e => setActorFilter(e.target.value)} className={selectCls}>
            <option value="all">All actors</option>
            <option value="web">Web (me)</option>
            <option value="service">Service (AI / sync)</option>
          </select>
          <select value={days} onChange={e => setDays(Number(e.target.value))} className={selectCls}>
            <option value={1}>Last 24h</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="text-xs px-3 py-2 rounded-lg border border-ink-200 text-ink-600 hover:border-ink-400 transition-colors duration-150 min-h-[44px]"
          >
            ↻ Refresh
          </button>
          {logs.length > 0 && (
            <button
              onClick={() => clearLogs.mutate()}
              disabled={clearLogs.isPending}
              className="text-xs px-3 py-2 rounded-lg border border-red-200 text-red-500 hover:border-red-400 transition-colors duration-150 min-h-[44px] disabled:opacity-50"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-cream-200 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl p-3">
          ⚠ {(error as Error).message}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-ink-400">
          <div className="text-3xl mb-3">📜</div>
          <p className="text-sm">No activity matches this filter</p>
        </div>
      )}

      {/* 4-column matrix — a lone entry occupies one cell; a same-transaction
          cascade spans (up to 4) columns and renders as a connected chain. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
        {groups.map(group => (
          group.length === 1
            ? <LogCard key={group[0].id} log={group[0]} expanded={expanded === group[0].id} onToggle={() => toggle(group[0].id)} />
            : <CascadeChain key={group[0].id} group={group} expandedId={expanded} onToggle={toggle} />
        ))}
      </div>

      <p className="text-[11px] text-ink-400 mt-2">{filtered.length} / {logs.length} entries · retention 30 days</p>
    </>
  )
}
