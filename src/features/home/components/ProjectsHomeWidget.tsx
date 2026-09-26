import { Link } from 'react-router-dom'
import { FolderKanban } from 'lucide-react'
import { Skeleton, EmptyState } from '../../../shared/ui'
import { useProjects, useProjectStats } from '../../projects/hooks/useProjects'
import type { Project } from '../../projects/types'
import { PROJECT_COLOR } from '../../projects/projectTones'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceTile } from './GlanceTile'

const SHOWN = 4

type Stats = Record<string, { total?: number; done?: number } | undefined>
const pctOf = (stats: Stats, id: string) => {
  const s = stats[id]
  return s?.total ? Math.round(((s.done ?? 0) / s.total) * 100) : null
}

function useActiveProjects(enabled: boolean) {
  const { data: projects = [], isLoading } = useProjects({ enabled })
  const { data: stats = {} } = useProjectStats({ enabled })
  return { active: projects.filter((p: Project) => p.status === 'active'), stats: stats as Stats, isLoading }
}

export function ProjectsHomeWidget() {
  const ws = useWidgetState('projects', { mobileCollapsed: true })
  const { active, stats, isLoading } = useActiveProjects(!ws.collapsed)
  return (
    <WidgetShell title="Active projects" icon={<FolderKanban />} ws={ws} to="/projects">
      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : active.length === 0 ? (
        <EmptyState title="No active projects" className="py-4" />
      ) : (
        <ul className="space-y-1">
          {active.slice(0, SHOWN).map(p => {
            const pct = pctOf(stats, p.id)
            return (
              <li key={p.id}>
                <Link to="/projects" className="-mx-2 block rounded-row px-2 py-1.5 transition-colors duration-100 hover:bg-surface-hover">
                  <span className="mb-1 flex items-center gap-2">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: PROJECT_COLOR[p.color] }} />
                    <span className="min-w-0 flex-1 truncate text-body text-fg-2">{p.name}</span>
                    <span className="shrink-0 text-micro tabular-nums text-fg-muted">{pct == null ? '—' : `${pct}%`}</span>
                  </span>
                  <span className="block h-1 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full bg-success transition-[width] duration-300" style={{ width: `${pct ?? 0}%` }} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetShell>
  )
}

export function ProjectsTile() {
  const { active, stats, isLoading } = useActiveProjects(true)
  const top = active[0]
  const pct = top ? pctOf(stats, top.id) : null
  return (
    <GlanceTile
      label="Projects"
      icon={<FolderKanban />}
      to="/projects"
      loading={isLoading}
      value={<>{active.length}<span className="ml-1 text-meta font-medium text-fg-muted">active</span></>}
      hint={top ? `${top.name}${pct != null ? ` · ${pct}%` : ''}` : 'None active'}
    />
  )
}
