import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProjects, useProjectStats } from '../../projects/hooks/useProjects'
import { haptic } from '../../../shared/utils/haptics'

const COLOR_DOT: Record<string, string> = {
  slate: 'bg-slate-400', blue: 'bg-blue-400', violet: 'bg-violet-400',
  emerald: 'bg-emerald-400', amber: 'bg-amber-400', rose: 'bg-rose-400',
}

export function ProjectsHomeWidget() {
  const { data: projects = [], isLoading } = useProjects()
  const { data: stats = {} }               = useProjectStats()
  // Reference widget — collapsed by default on a phone so Home leads with the
  // actionable cards. Desktop ignores this (body is always `sm:block`).
  const [collapsed, setCollapsed] = useState(true)

  if (isLoading) return null

  const active = projects.filter(p => p.status === 'active').slice(0, 4)
  if (active.length === 0) return null

  return (
    <div className="bg-cream-50 rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center min-w-0">
          <button
            type="button"
            onClick={() => { haptic('light'); setCollapsed(c => !c) }}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            className="sm:hidden text-ink-400 hover:text-ink-700 -ml-2 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
          >
            {collapsed ? '▶' : '▼'}
          </button>
          <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide truncate">Active Projects</h3>
        </div>
        <Link to="/projects" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
      </div>

      <div className={`space-y-2.5 ${collapsed ? 'hidden sm:block' : ''}`}>
        {active.map(p => {
          const s = stats[p.id]
          const total = s?.total ?? 0
          const done  = s?.done ?? 0
          const pct   = total > 0 ? Math.round((done / total) * 100) : 0
          return (
            <Link key={p.id} to="/projects" className="block group">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full shrink-0 ${COLOR_DOT[p.color] ?? 'bg-ink-300'}`} />
                <span className="text-sm text-ink-700 truncate flex-1 group-hover:text-accent-600 transition-colors">{p.name}</span>
                <span className="text-[11px] text-ink-400 shrink-0">{total > 0 ? `${pct}%` : '—'}</span>
              </div>
              <div className="h-1 rounded-full bg-ink-100 overflow-hidden">
                <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
