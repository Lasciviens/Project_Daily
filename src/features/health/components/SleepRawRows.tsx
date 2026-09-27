import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { formatSleepHours as fmtHrs } from '../healthAggregate'
import type { HealthMetric } from '../api/healthApi'

// The raw health_metrics rows behind the visible nights, so what the webhook
// received can be checked against iPhone Health directly.
export function SleepRawRows({ points }: { points: HealthMetric[] }) {
  const [open, setOpen] = useState(false)
  const hhmm = (s: unknown) => (typeof s === 'string' && s.length >= 16 ? s.slice(11, 16) : '?')
  return (
    <div className="border-t border-line pt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="btn-ghost btn-sm gap-1 px-2 text-meta">
        {open ? <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
        {open ? 'Hide raw data' : `Raw data (${points.length} rows)`}
      </button>
      {open && (
        <div className="mt-1 flex max-h-64 flex-col gap-1 overflow-y-auto">
          {[...points]
            .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))
            .map(p => {
              const v = (p.value ?? {}) as Record<string, unknown>
              const isSession = typeof v.totalSleep === 'number'
              return (
                <div key={p.id} className="flex flex-wrap gap-x-2 gap-y-0.5 rounded bg-surface-2 px-2 py-1 font-mono text-micro font-normal">
                  <span className="text-fg-muted">{p.date}</span>
                  <span className={p.source === 'manual' ? 'font-semibold text-fg' : 'text-fg-faint'}>{p.source || '—'}</span>
                  {isSession ? (
                    <>
                      <span className="text-fg-2">{hhmm(v.sleepStart)}→{hhmm(v.sleepEnd)}</span>
                      <span className="font-semibold text-fg">{fmtHrs(Number(v.totalSleep))}</span>
                      <span className="text-fg-faint">C{fmtHrs(Number(v.core ?? 0))} R{fmtHrs(Number(v.rem ?? 0))} D{fmtHrs(Number(v.deep ?? 0))} A{fmtHrs(Number(v.awake ?? 0))}</span>
                    </>
                  ) : (
                    <span className="text-fg-2">{typeof v.value === 'string' ? v.value : '?'} {typeof v.qty === 'number' ? fmtHrs(v.qty) : ''}</span>
                  )}
                </div>
              )
            })}
          {points.length === 0 && <p className="text-meta text-fg-muted">No rows in this range.</p>}
        </div>
      )}
    </div>
  )
}
