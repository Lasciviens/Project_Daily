import { TonePill, Truncate } from '../../../shared/ui'
import { PROJECT_COLOR, PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from '../projectTones'
import { ProjectProgress } from './ProjectProgress'
import type { Project } from '../types'
import type { ProjectStat } from '../api/projectsApi'

interface Props {
  project: Project
  stat?:   ProjectStat
  onOpen:  () => void
}

export function ProjectCard({ project, stat, onOpen }: Props) {
  return (
    <button type="button" onClick={onOpen} className="card-interactive relative w-full overflow-hidden text-left">
      <span aria-hidden className="absolute bottom-0 left-0 top-0 w-1.5" style={{ background: PROJECT_COLOR[project.color] }} />
      <div className="flex flex-col gap-2.5 py-4 pl-5 pr-4">
        <div className="flex items-start justify-between gap-2">
          <Truncate as="h3" lines={2} className="text-lead font-semibold leading-snug text-fg">{project.name}</Truncate>
          <TonePill tone={PROJECT_STATUS_TONE[project.status]} className="shrink-0">{PROJECT_STATUS_LABEL[project.status]}</TonePill>
        </div>
        {project.description && <Truncate as="p" lines={2} className="text-meta text-fg-muted">{project.description}</Truncate>}
        <ProjectProgress total={stat?.total ?? 0} done={stat?.done ?? 0} inProgress={stat?.in_progress ?? 0} className="mt-1" />
      </div>
    </button>
  )
}
