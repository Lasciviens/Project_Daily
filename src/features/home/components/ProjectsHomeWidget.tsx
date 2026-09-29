import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban } from 'lucide-react'
import { Skeleton, EmptyState, Truncate, AnimatedNumber } from '../../../shared/ui'
import { useProjects, useProjectStats } from '../../projects/hooks/useProjects'
import type { Project } from '../../projects/types'
import { PROJECT_COLOR } from '../../projects/projectTones'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceTile } from './GlanceTile'
import { TileDetail } from './TileDetail'
import { useTilePopup } from '../hooks/useTilePopup'

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
  const data = useActiveProjects(!ws.collapsed)
  return (
    <WidgetShell title="Active projects" icon={<FolderKanban />} ws={ws} to="/projects">
      <ProjectsList {...data} />
    </WidgetShell>
  )
}

/** The widget's body — also what the glance tile opens on a wide Home. */
function ProjectsList({ active, stats, isLoading, inPopup = false }: ReturnType<typeof useActiveProjects> & { inPopup?: boolean }) {
  return (
    <>
      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : active.length === 0 ? (
        <EmptyState title="No active projects" className="py-4" />
      ) : (
        <ul className="space-y-1">
          {/* The popup has the room for every active project; the card shows the first few. */}
          {(inPopup ? active : active.slice(0, SHOWN)).map(p => {
            const pct = pctOf(stats, p.id)
            return (
              <li key={p.id}>
                <Link to="/projects" replace={inPopup} className="-mx-2 block rounded-row px-2 py-1.5 transition-colors duration-100 hover:bg-surface-hover">
                  <span className="mb-1 flex items-center gap-2">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: PROJECT_COLOR[p.color] }} />
                    <Truncate className="flex-1 text-body text-fg-2">{p.name}</Truncate>
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
    </>
  )
}

export function ProjectsTile() {
  const data = useActiveProjects(true)
  const { active, stats, isLoading } = data
  const popup = useTilePopup()
  const [open, setOpen] = useState(false)
  const top = active[0]
  const pct = top ? pctOf(stats, top.id) : null
  return (
    <>
      <GlanceTile
        label="Projects"
        icon={<FolderKanban />}
        {...(popup ? { onClick: () => setOpen(true) } : { to: '/projects' })}
        loading={isLoading}
        value={<><AnimatedNumber value={active.length} /><span className="ml-1 text-meta font-medium text-fg-muted">active</span></>}
        hint={top ? `${top.name}${pct != null ? ` · ${pct}%` : ''}` : 'None active'}
      />
      {popup && (
        <TileDetail open={open} onClose={() => setOpen(false)} title="Active projects" to="/projects" openLabel="Open Projects">
          <ProjectsList {...data} inPopup />
        </TileDetail>
      )}
    </>
  )
}
