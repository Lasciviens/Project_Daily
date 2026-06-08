import { InlineText } from './InlineText'
import { InlineTextArea } from './InlineTextArea'
import { StatusCycleChip, PROJECT_STATUS_COLORS } from './StatusCycleChip'
import { PhaseCard } from './PhaseCard'
import { toast } from '../../../app/store'
import {
  usePhases, useItems,
  useUpdateProject, useDeleteProject,
  useCreatePhase, useUpdatePhase, useDeletePhase,
  useCreateItem, useUpdateItem, useDeleteItem,
} from '../hooks/useProjects'
import type { Project, ProjectStatus } from '../types'

const PROJECT_STATUSES: ProjectStatus[] = ['active', 'on_hold', 'completed', 'archived']

const COLOR_DOT: Record<string, string> = {
  slate:   'bg-slate-400',
  blue:    'bg-blue-400',
  violet:  'bg-violet-400',
  emerald: 'bg-emerald-400',
  amber:   'bg-amber-400',
  rose:    'bg-rose-400',
}

const COLORS = ['slate', 'blue', 'violet', 'emerald', 'amber', 'rose'] as const

interface Props {
  project:  Project
  onDelete: () => void
}

export function ProjectDetail({ project, onDelete }: Props) {
  const { data: phases = [] }  = usePhases(project.id)
  const { data: allItems = [] } = useItems(project.id)

  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const createPhase   = useCreatePhase(project.id)
  const updatePhase   = useUpdatePhase(project.id)
  const deletePhase   = useDeletePhase(project.id)
  const createItem    = useCreateItem(project.id)
  const updateItem    = useUpdateItem(project.id)
  const deleteItem    = useDeleteItem(project.id)

  async function handleDeleteProject() {
    if (!confirm(`Delete "${project.name}"? This will remove all phases and items.`)) return
    await deleteProject.mutateAsync(project.id)
    toast.success('Project deleted')
    onDelete()
  }

  async function handleAddPhase() {
    await createPhase.mutateAsync({ project_id: project.id, name: 'New phase' })
  }

  async function handleAddItem(phaseId: string) {
    const phase = phases.find(p => p.id === phaseId)
    if (!phase) return
    await createItem.mutateAsync({ phase_id: phaseId, project_id: project.id, title: 'New item' })
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0 overflow-y-auto px-4 py-4">
      {/* Project header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <InlineText
            value={project.name}
            onSave={name => updateProject.mutate({ id: project.id, patch: { name } })}
            className="text-base font-bold text-ink-900"
            inputClass="text-base font-bold text-ink-900 w-64"
          />
          <StatusCycleChip
            value={project.status}
            options={PROJECT_STATUSES}
            colors={PROJECT_STATUS_COLORS as Partial<Record<ProjectStatus, string>>}
            onCycle={status => updateProject.mutate({ id: project.id, patch: { status } })}
          />
          <button
            onClick={handleDeleteProject}
            className="text-[10px] text-ink-300 hover:text-red-400 ml-auto"
            title="Delete project"
          >
            ✕
          </button>
        </div>

        <InlineTextArea
          value={project.description}
          onSave={description => updateProject.mutate({ id: project.id, patch: { description } })}
          placeholder="Add a description…"
        />

        {/* Color picker */}
        <div className="flex gap-1.5 mt-1">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => updateProject.mutate({ id: project.id, patch: { color: c } })}
              className={`w-4 h-4 rounded-full ${COLOR_DOT[c]} transition-transform hover:scale-110 ${
                project.color === c ? 'ring-2 ring-offset-1 ring-ink-400' : ''
              }`}
              title={c}
            />
          ))}
        </div>
      </div>

      {/* Phases */}
      <div className="space-y-3">
        {phases.map(phase => (
          <PhaseCard
            key={phase.id}
            phase={phase}
            items={allItems.filter(i => i.phase_id === phase.id)}
            onUpdatePhase={patch => updatePhase.mutate({ id: phase.id, patch })}
            onDeletePhase={() => deletePhase.mutate(phase.id)}
            onAddItem={() => handleAddItem(phase.id)}
            onUpdateItem={(itemId, patch) => updateItem.mutate({ id: itemId, patch })}
            onDeleteItem={itemId => deleteItem.mutate(itemId)}
          />
        ))}

        <button
          onClick={handleAddPhase}
          disabled={createPhase.isPending}
          className="w-full text-xs text-ink-400 hover:text-accent-600 py-2 rounded-xl border border-dashed border-ink-200 hover:border-accent-300 transition-colors"
        >
          + Add phase
        </button>
      </div>
    </div>
  )
}
