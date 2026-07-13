import type { Project, ProjectStatus } from '../types'
import type { ProjectStat } from '../api/projectsApi'

const COLOR_BAR: Record<string, string> = {
  slate:   'bg-slate-400',
  blue:    'bg-blue-400',
  violet:  'bg-violet-400',
  emerald: 'bg-emerald-400',
  amber:   'bg-amber-400',
  rose:    'bg-rose-400',
}

const STATUS_PILL: Record<ProjectStatus, string> = {
  active:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  on_hold:   'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-blue-50 text-blue-700 border-blue-200',
  archived:  'bg-ink-100 text-ink-500 border-ink-200',
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived',
}

interface Props {
  project: Project
  stat?:   ProjectStat
  onOpen:  () => void
}

export function ProjectCard({ project, stat, onOpen }: Props) {
  const total = stat?.total ?? 0
  const done  = stat?.done ?? 0
  const wip   = stat?.in_progress ?? 0
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative w-full text-left bg-cream-50 border border-ink-200 rounded-2xl overflow-hidden hover:border-accent-300 hover:shadow-card-hover transition-all min-h-[44px]"
    >
      {/* Color accent stripe */}
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${COLOR_BAR[project.color] ?? 'bg-ink-300'}`} />

      <div className="pl-5 pr-4 py-4 flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-ink-900 leading-snug line-clamp-2">{project.name}</h3>
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_PILL[project.status]}`}>
            {STATUS_LABEL[project.status]}
          </span>
        </div>

        {project.description && (
          <p className="text-xs text-ink-500 line-clamp-2">{project.description}</p>
        )}

        {/* Progress */}
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-ink-400">
            <span>{total > 0 ? `${done}/${total} done` : 'No items yet'}</span>
            <span className="flex items-center gap-2">
              {wip > 0 && <span className="text-accent-600 font-medium">{wip} in progress</span>}
              {total > 0 && <span className="font-semibold text-ink-600">{pct}%</span>}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}
