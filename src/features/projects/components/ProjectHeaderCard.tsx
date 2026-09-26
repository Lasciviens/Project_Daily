import { Trash2 } from 'lucide-react'
import { Card, IconButton } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { haptic } from '../../../shared/utils/haptics'
import { InlineText } from './InlineText'
import { InlineTextArea } from './InlineTextArea'
import { StatusCycleChip } from './StatusCycleChip'
import { ProjectProgress } from './ProjectProgress'
import { PROJECT_COLOR, PROJECT_COLORS, PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from '../projectTones'
import { useDeleteProject, useUpdateProject } from '../hooks/useProjects'
import type { Project, ProjectItem, ProjectStatus } from '../types'

const PROJECT_STATUSES: ProjectStatus[] = ['active', 'on_hold', 'completed', 'archived']

/** Name, status, description, progress and colour of one project. */
export function ProjectHeaderCard({ project, items, onDeleted }: { project: Project; items: ProjectItem[]; onDeleted: () => void }) {
  const modal = useEntityModal()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const patch = (p: Parameters<typeof updateProject.mutate>[0]['patch']) => updateProject.mutate({ id: project.id, patch: p })

  async function handleDelete() {
    const ok = await modal.confirm({
      title: `Delete "${project.name}"?`,
      message: 'This removes all its phases and items.',
      confirmLabel: 'Delete project',
      destructive: true,
    })
    if (!ok) return
    try { await deleteProject.mutateAsync(project.id) } catch { return }
    onDeleted()
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: PROJECT_COLOR[project.color] }} />
        <InlineText
          value={project.name}
          onSave={name => patch({ name })}
          className="min-w-0 flex-1 truncate text-title font-semibold text-fg"
          inputClass="min-w-0 max-w-[20rem] flex-1 text-title font-semibold text-fg"
        />
        <StatusCycleChip
          value={project.status}
          options={PROJECT_STATUSES}
          tones={PROJECT_STATUS_TONE}
          labels={PROJECT_STATUS_LABEL}
          onCycle={status => patch({ status })}
        />
        <IconButton label={`Delete project ${project.name}`} onClick={() => { void handleDelete() }} disabled={deleteProject.isPending}
          className="ml-auto hover:text-danger">
          <Trash2 />
        </IconButton>
      </div>

      <InlineTextArea value={project.description} onSave={description => patch({ description })} placeholder="Add a description…" />

      <ProjectProgress
        total={items.length}
        done={items.filter(i => i.status === 'done').length}
        inProgress={items.filter(i => i.status === 'in_progress').length}
        thick
      />

      <div role="radiogroup" aria-label="Project colour" className="flex gap-1">
        {PROJECT_COLORS.map(c => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={project.color === c}
            aria-label={c}
            title={c}
            onClick={() => { haptic('light'); patch({ color: c }) }}
            className="grid h-8 w-8 place-items-center rounded-full [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <span
              className={`h-4 w-4 rounded-full transition-transform hover:scale-110 ${project.color === c ? 'ring-2 ring-fg-muted ring-offset-2 ring-offset-surface' : ''}`}
              style={{ background: PROJECT_COLOR[c] }}
            />
          </button>
        ))}
      </div>
    </Card>
  )
}
