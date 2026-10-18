import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { MetaLine, TonePill, Truncate } from '../../../shared/ui'
import type { Task } from '../../todo/types'
import { AREA_LABEL, KIND_LABEL, progressLine, progressValue, type ProjectSummary } from '../projectModel'
import { KIND_ICON } from '../projectIcons'
import { ProgressBar } from './ProgressBar'
import type { Project } from '../types'

/** One project in the list: what it is, where it stands, what's next. The rest is on its page. */
export function ProjectCard({ project, summary }: { project: Project; summary: ProjectSummary<Task> }) {
  const Icon = KIND_ICON[project.kind ?? 'blank']
  const value = progressValue(summary)
  return (
    <Link to={`/projects/${project.id}`} className="card-interactive flex flex-col gap-3 p-4 text-left">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-[18px] [&_svg]:w-[18px]">
          <Icon />
        </span>
        <div className="min-w-0 flex-1">
          <Truncate as="h3" lines={2} className="text-lead font-semibold leading-snug text-fg">{project.name}</Truncate>
          <MetaLine className="text-meta text-fg-muted" items={[KIND_LABEL[project.kind ?? 'blank'], AREA_LABEL[project.area ?? 'personal']]} />
        </div>
        <ChevronRight aria-hidden className="mt-1 h-4 w-4 shrink-0 text-fg-faint" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-meta text-fg-muted">
          <Truncate className="min-w-0">{progressLine(summary)}</Truncate>
          {summary.tasksTotal > 0 && <span className="shrink-0 tabular-nums">{summary.tasksDone}/{summary.tasksTotal} tasks</span>}
        </div>
        <ProgressBar value={value} label={`${Math.round(value * 100)}% done`} />
      </div>
      {(summary.nextTask || summary.openQuestions > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5">
          {summary.nextTask && (
            <span className="flex min-w-0 flex-1 basis-40 items-baseline gap-2 text-body text-fg-2">
              <span className="section-label shrink-0">Next</span>
              <Truncate className="min-w-0">{summary.nextTask.title}</Truncate>
            </span>
          )}
          {summary.openQuestions > 0 && (
            <TonePill tone="warn" className="shrink-0">
              {summary.openQuestions} open question{summary.openQuestions === 1 ? '' : 's'}
            </TonePill>
          )}
        </div>
      )}
    </Link>
  )
}
