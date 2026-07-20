import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { Sheet } from '../../../shared/components/Sheet'
import { haptic } from '../../../shared/utils/haptics'

// CRUD audit trail (audit_logs, written by DB triggers — migration 037, +052
// added dev_requests). Redesigned from a cramped 4-column card matrix into a
// READABLE TIMELINE: every entry is a plain-language sentence ("You created
// Task «…»"), same-transaction cascades group into one connected block, and
// the raw-JSON dump was replaced with a readable key/value snapshot. Range is
// a preset (incl. 1h) OR an explicit from/to date-time window.

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

// Friendly, singular labels for the raw table names — "ne olmuş anlıyorum".
const TABLE_LABEL: Record<string, string> = {
  tasks: 'Task', time_blocks: 'Schedule block',
  recipes: 'Recipe', recipe_ingredients: 'Recipe ingredient',
  recipe_ingredient_library: 'Ingredient', recipe_meal_plans: 'Meal plan',
  shop_categories: 'Shop category', shop_items: 'Shop item',
  projects: 'Project', project_phases: 'Project phase', project_items: 'Project item',
  user_movie_entries: 'Movie', user_tv_entries: 'TV series', user_tv_episodes: 'TV episode',
  user_transit_stops: 'Transit stop', user_transit_routes: 'Transit route',
  work_notes: 'Work note', work_weekly_goals: 'Weekly goal', work_pinned_links: 'Pinned link',
  dev_requests: 'Dev request',
}
const friendlyTable = (t: string) => TABLE_LABEL[t] ?? t.replace(/_/g, ' ')

const OP_META: Record<AuditLog['operation'], { verb: string; dot: string; text: string }> = {
  INSERT: { verb: 'created', dot: 'bg-emerald-400', text: 'text-emerald-600' },
  UPDATE: { verb: 'updated', dot: 'bg-accent-400',  text: 'text-accent-600' },
  DELETE: { verb: 'deleted', dot: 'bg-red-400',     text: 'text-red-500' },
}

const RANGES = [
  { label: 'Last 1h',   hours: 1 },
  { label: 'Last 24h',  hours: 24 },
  { label: 'Last 7 days',  hours: 168 },
  { label: 'Last 30 days', hours: 720 },
]

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// Best-effort human name for the affected row.
function rowLabel(log: AuditLog): string {
  const d = log.new_data ?? log.old_data ?? {}
  for (const key of ['title', 'name', 'label', 'message', 'content']) {
    const v = d[key]
    if (typeof v === 'string' && v.trim()) return v.length > 60 ? v.slice(0, 60) + '…' : v
  }
  return log.row_id ? `#${log.row_id.slice(0, 8)}` : '—'
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// Keys not worth showing in a snapshot (plumbing).
const HIDDEN_KEYS = new Set(['id', 'user_id', 'created_at', 'updated_at', 'sort_order'])

// Range is resolved INSIDE queryFn (Date.now() there is fine; at render top-
// level it trips the react-hooks purity rule). Custom window wins when either
// bound is set; else the preset relative range.
function useAuditLogs(rangeHours: number, customFrom: string, customTo: string) {
  return useQuery<AuditLog[]>({
    queryKey: ['audit-logs', rangeHours, customFrom, customTo],
    queryFn: async () => {
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

// UPDATE → only the fields that changed (before → after). INSERT/DELETE → a
// readable key/value snapshot of the row (was a raw JSON dump). For a DELETE
// this snapshot IS the recovery source (migration 037 stores the full old row).
function DiffView({ log }: { log: AuditLog }) {
  if (log.operation === 'UPDATE') {
    const keys = [...new Set([...Object.keys(log.old_data ?? {}), ...Object.keys(log.new_data ?? {})])]
      .filter(k => !HIDDEN_KEYS.has(k))
      .filter(k => fmtValue(log.old_data?.[k]) !== fmtValue(log.new_data?.[k]))
      .sort()
    if (keys.length === 0) return <p className="text-xs text-ink-400">No visible field changes.</p>
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">
              <th className="text-left py-1 pr-4">Field</th>
              <th className="text-left py-1 pr-4">Before</th>
              <th className="text-left py-1">After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {keys.map(k => (
              <tr key={k}>
                <td className="py-1 pr-4 font-medium text-ink-600 whitespace-nowrap align-top">{k}</td>
                <td className="py-1 pr-4 text-red-500 break-all align-top">{fmtValue(log.old_data?.[k])}</td>
                <td className="py-1 text-emerald-600 break-all align-top">{fmtValue(log.new_data?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  const data = (log.operation === 'DELETE' ? log.old_data : log.new_data) ?? {}
  const entries = Object.entries(data).filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== '')
  return (
    <div className="flex flex-col gap-0.5">
      {log.operation === 'DELETE' && (
        <p className="text-[11px] text-ink-400 mb-1">Deleted row snapshot (recoverable within 30 days):</p>
      )}
      <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-0.5 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-ink-500">{k}</dt>
            <dd className="text-ink-800 break-all">{fmtValue(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function LogRow({ log, expanded, onToggle, nested }: { log: AuditLog; expanded: boolean; onToggle: () => void; nested?: boolean }) {
  const op = OP_META[log.operation]
  return (
    <div className={nested ? '' : 'rounded-xl border border-ink-100 bg-cream-50 overflow-hidden'}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2 min-h-[44px] text-left hover:bg-cream-100 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${op.dot}`} />
        {/* Plain-language sentence */}
        <span className="text-sm text-ink-700 min-w-0 flex-1 truncate">
          <span className="font-medium text-ink-500">{log.actor === 'web' ? 'You' : 'AI / sync'}</span>{' '}
          <span className={op.text}>{op.verb}</span>{' '}
          {friendlyTable(log.table_name)}{' '}
          <span className="font-semibold text-ink-900">«{rowLabel(log)}»</span>
        </span>
        <span className="text-[11px] text-ink-400 flex-shrink-0 tabular-nums hidden sm:block">{fmtDate(log.created_at)}</span>
        <span className="text-[10px] text-ink-300 flex-shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="border-t border-ink-100 bg-ink-50/60 px-3 py-2">
          <p className="text-[11px] text-ink-400 mb-1.5 sm:hidden">{fmtDate(log.created_at)}</p>
          <DiffView log={log} />
        </div>
      )}
    </div>
  )
}

// Same-transaction group (>1 change) — a cascade. Stacked vertically with a
// left rail + connector so "this change triggered those" reads top-to-bottom
// (no more horizontal grid-span cramming).
function CascadeBlock({ group, expandedId, onToggle }: { group: AuditLog[]; expandedId: string | null; onToggle: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-accent-200 bg-accent-50/40 overflow-hidden">
      <p className="text-[10px] font-semibold text-accent-600 uppercase tracking-wide px-3 py-1.5 border-b border-accent-100">
        Linked · same transaction · {group.length} changes
      </p>
      <div className="pl-3 border-l-2 border-accent-200 ml-3 my-1 divide-y divide-ink-100/70">
        {group.map(log => (
          <LogRow key={log.id} log={log} nested expanded={expandedId === log.id} onToggle={() => onToggle(log.id)} />
        ))}
      </div>
    </div>
  )
}

export function ActivityLogTab() {
  const [rangeHours, setRangeHours] = useState(168)
  const [customFrom, setCustomFrom] = useState('')   // datetime-local
  const [customTo, setCustomTo] = useState('')
  const [tableFilter, setTableFilter] = useState('all')
  const [opFilter, setOpFilter] = useState('all')
  const [actorFilter, setActorFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const usingCustom = !!(customFrom || customTo)
  const { data: logs = [], isLoading, error, refetch } = useAuditLogs(rangeHours, customFrom, customTo)
  const clearLogs = useClearAuditLogs()

  const tables = useMemo(() => [...new Set(logs.map(l => l.table_name))].sort(), [logs])

  const filtered = useMemo(() => logs.filter(l =>
    (tableFilter === 'all' || l.table_name === tableFilter) &&
    (opFilter === 'all' || l.operation === opFilter) &&
    (actorFilter === 'all' || l.actor === actorFilter)
  ), [logs, tableFilter, opFilter, actorFilter])

  const groups = useMemo(() => {
    const out: AuditLog[][] = []
    for (const log of filtered) {
      const last = out[out.length - 1]
      if (last && last[0].tx_id === log.tx_id) last.push(log)
      else out.push([log])
    }
    return out
  }, [filtered])

  const selectCls = 'min-h-[44px] text-xs border border-ink-200 rounded-lg px-2 bg-cream-50 text-ink-700'
  // max-w caps the datetime-local so it doesn't stretch full-width (width
  // standard W3) and the from→to pair reads as one control row on mobile.
  const dtCls = 'min-h-[44px] max-w-[11rem] min-w-0 text-xs border border-ink-200 rounded-lg px-2 bg-cream-50 text-ink-700'
  // Full-width stacked variant for the mobile Filtreler sheet.
  const sheetFieldCls = 'min-h-[44px] w-full border border-ink-200 rounded-lg px-3 bg-cream-50 text-sm text-ink-700'
  const activeFilterCount =
    (tableFilter !== 'all' ? 1 : 0) +
    (opFilter !== 'all' ? 1 : 0) +
    (actorFilter !== 'all' ? 1 : 0) +
    (usingCustom ? 1 : 0)
  const toggle = (id: string) => setExpanded(e => e === id ? null : id)

  return (
    <>
      {/* Filter bar — desktop (sm+): everything inline, unchanged */}
      <div className="hidden sm:flex sm:flex-col gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={tableFilter} onChange={e => setTableFilter(e.target.value)} className={selectCls}>
            <option value="all">All types</option>
            {tables.map(t => <option key={t} value={t}>{friendlyTable(t)}</option>)}
          </select>
          <select value={opFilter} onChange={e => setOpFilter(e.target.value)} className={selectCls}>
            <option value="all">All operations</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
          </select>
          <select value={actorFilter} onChange={e => setActorFilter(e.target.value)} className={selectCls}>
            <option value="all">All actors</option>
            <option value="web">You</option>
            <option value="service">AI / sync</option>
          </select>
          <select
            value={rangeHours}
            onChange={e => { setRangeHours(Number(e.target.value)); setCustomFrom(''); setCustomTo('') }}
            className={`${selectCls} ${usingCustom ? 'opacity-50' : ''}`}
          >
            {RANGES.map(r => <option key={r.hours} value={r.hours}>{r.label}</option>)}
          </select>
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={() => refetch()} title="Refresh" aria-label="Refresh" className="text-xs px-3 py-2 rounded-lg border border-ink-200 text-ink-600 hover:border-ink-400 transition-colors min-h-[44px] whitespace-nowrap">↻ Refresh</button>
            {logs.length > 0 && (
              <button onClick={() => clearLogs.mutate()} disabled={clearLogs.isPending}
                className="text-xs px-3 py-2 rounded-lg border border-red-200 text-red-500 hover:border-red-400 transition-colors min-h-[44px] disabled:opacity-50 whitespace-nowrap">
                Clear all
              </button>
            )}
          </div>
        </div>
        {/* Explicit from/to window */}
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-ink-400">
          <span>Or exact window:</span>
          <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className={dtCls} aria-label="From" />
          <span>→</span>
          <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)} className={dtCls} aria-label="To" />
          {usingCustom && (
            <button onClick={() => { setCustomFrom(''); setCustomTo('') }} className="text-accent-600 hover:text-accent-700 px-2 min-h-[44px] inline-flex items-center">clear</button>
          )}
        </div>
      </div>

      {/* Filter bar — mobile (<sm): only range + Filtreler + Refresh; the rest lives in a Sheet */}
      <div className="flex sm:hidden items-center gap-2 mb-3">
        <select
          value={rangeHours}
          onChange={e => { setRangeHours(Number(e.target.value)); setCustomFrom(''); setCustomTo('') }}
          className={`${selectCls} flex-1 min-w-0 ${usingCustom ? 'opacity-50' : ''}`}
        >
          {RANGES.map(r => <option key={r.hours} value={r.hours}>{r.label}</option>)}
        </select>
        <button
          type="button"
          onClick={() => { haptic('light'); setFiltersOpen(true) }}
          className="press-feedback relative inline-flex items-center gap-1.5 text-xs px-3 rounded-lg border border-ink-200 text-ink-600 min-h-[44px] whitespace-nowrap"
        >
          Filtreler
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent-500 text-white text-[10px] font-semibold tabular-nums">{activeFilterCount}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => refetch()}
          title="Refresh"
          aria-label="Refresh"
          className="press-feedback inline-flex items-center justify-center text-sm rounded-lg border border-ink-200 text-ink-600 min-h-[44px] min-w-[44px]"
        >
          ↻
        </button>
      </div>

      {/* Mobile Filtreler sheet — type/op/actor + exact window + Clear all */}
      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filtreler"
        size="sm"
        footer={
          <div className="flex items-center gap-2">
            {logs.length > 0 && (
              <button
                type="button"
                onClick={() => clearLogs.mutate()}
                disabled={clearLogs.isPending}
                className="press-feedback text-xs px-3 rounded-lg border border-red-200 text-red-500 min-h-[44px] disabled:opacity-50"
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="press-feedback ml-auto text-sm font-semibold px-5 rounded-lg bg-accent-500 text-white min-h-[44px]"
            >
              Done
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 p-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-500">Type</span>
            <select value={tableFilter} onChange={e => setTableFilter(e.target.value)} className={sheetFieldCls}>
              <option value="all">All types</option>
              {tables.map(t => <option key={t} value={t}>{friendlyTable(t)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-500">Operation</span>
            <select value={opFilter} onChange={e => setOpFilter(e.target.value)} className={sheetFieldCls}>
              <option value="all">All operations</option>
              <option value="INSERT">Created</option>
              <option value="UPDATE">Updated</option>
              <option value="DELETE">Deleted</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-500">Actor</span>
            <select value={actorFilter} onChange={e => setActorFilter(e.target.value)} className={sheetFieldCls}>
              <option value="all">All actors</option>
              <option value="web">You</option>
              <option value="service">AI / sync</option>
            </select>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-500">Exact window</span>
            <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className={sheetFieldCls} aria-label="From" />
            <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)} className={sheetFieldCls} aria-label="To" />
            {usingCustom && (
              <button type="button" onClick={() => { setCustomFrom(''); setCustomTo('') }} className="self-start text-accent-600 hover:text-accent-700 text-xs min-h-[44px] inline-flex items-center">Clear window</button>
            )}
          </div>
        </div>
      </Sheet>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-11 rounded-xl bg-cream-200 animate-pulse" />)}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl p-3">⚠ {(error as Error).message}</div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-ink-400">
          <div className="text-3xl mb-3">📜</div>
          <p className="text-sm">No activity in this window</p>
        </div>
      )}

      {/* Readable single-column timeline */}
      <div className="flex flex-col gap-2">
        {groups.map(group => (
          group.length === 1
            ? <LogRow key={group[0].id} log={group[0]} expanded={expanded === group[0].id} onToggle={() => toggle(group[0].id)} />
            : <CascadeBlock key={group[0].id} group={group} expandedId={expanded} onToggle={toggle} />
        ))}
      </div>

      <p className="text-[11px] text-ink-400 mt-3">{filtered.length} / {logs.length} entries · retention 30 days</p>
    </>
  )
}
