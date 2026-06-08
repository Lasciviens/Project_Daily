import { useState } from 'react'
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
import type { Project, ProjectStatus, ItemType } from '../types'

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

const TYPE_FILTERS: Array<{ type: ItemType; label: string; cls: string }> = [
  { type: 'update',      label: 'update',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { type: 'improvement', label: 'improve', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { type: 'ui_request',  label: 'UI',      cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  { type: 'bug',         label: 'bug',     cls: 'bg-red-50 text-red-700 border-red-200' },
  { type: 'wishlist',    label: 'wish',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
]

interface Props {
  project:  Project
  onDelete: () => void
}

export function ProjectDetail({ project, onDelete }: Props) {
  const [typeFilter, setTypeFilter] = useState<ItemType | null>(null)

  const { data: phases = [], isLoading: phasesLoading } = usePhases(project.id)
  const { data: allItems = [] }                          = useItems(project.id)

  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const createPhase   = useCreatePhase(project.id)
  const updatePhase   = useUpdatePhase(project.id)
  const deletePhase   = useDeletePhase(project.id)
  const createItem    = useCreateItem(project.id)
  const updateItem    = useUpdateItem(project.id)
  const deleteItem    = useDeleteItem(project.id)

  const doneCount = allItems.filter(i => i.status === 'done').length
  const wipCount  = allItems.filter(i => i.status === 'in_progress').length

  async function handleDeleteProject() {
    if (!confirm(`Delete "${project.name}"? This will remove all phases and items.`)) return
    try {
      await deleteProject.mutateAsync(project.id)
      toast.success('Project deleted')
      onDelete()
    } catch {
      toast.error('Failed to delete project')
    }
  }

  async function handleAddPhase() {
    try {
      await createPhase.mutateAsync({ project_id: project.id, name: 'New phase' })
    } catch {
      toast.error('Failed to add phase')
    }
  }

  async function handleAddItem(phaseId: string) {
    try {
      await createItem.mutateAsync({ phase_id: phaseId, project_id: project.id, title: 'New item' })
    } catch {
      toast.error('Failed to add item')
    }
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
            disabled={deleteProject.isPending}
            className={`text-[10px] ml-auto transition-colors ${
              deleteProject.isPending ? 'text-ink-200 cursor-not-allowed' : 'text-ink-300 hover:text-red-400'
            }`}
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

        {/* Stats strip */}
        {allItems.length > 0 && (
          <div className="flex items-center gap-3 text-[11px] text-ink-400 mt-0.5">
            <span>{allItems.length} items</span>
            {doneCount > 0 && <span className="text-emerald-600">{doneCount} done</span>}
            {wipCount  > 0 && <span className="text-accent-600">{wipCount} in progress</span>}
          </div>
        )}
      </div>

      {/* Type filter chips */}
      {allItems.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap -mt-2">
          <button
            onClick={() => setTypeFilter(null)}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              typeFilter === null
                ? 'bg-ink-800 text-white border-ink-800'
                : 'bg-ink-50 text-ink-500 border-ink-200 hover:border-ink-400'
            }`}
          >
            all
          </button>
          {TYPE_FILTERS.map(f => {
            const count = allItems.filter(i => i.type === f.type).length
            if (count === 0) return null
            return (
              <button
                key={f.type}
                onClick={() => setTypeFilter(t => t === f.type ? null : f.type)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  typeFilter === f.type
                    ? f.cls + ' font-semibold'
                    : 'bg-ink-50 text-ink-500 border-ink-200 hover:border-ink-400'
                }`}
              >
                {f.label} {count}
              </button>
            )
          })}
        </div>
      )}

      {/* Phases */}
      <div className="space-y-3">
        {phasesLoading ? (
          [1, 2].map(i => <div key={i} className="h-12 bg-ink-100 rounded-xl animate-pulse" />)
        ) : (
          <>
            {phases.map(phase => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                items={allItems.filter(i => i.phase_id === phase.id)}
                typeFilter={typeFilter}
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
          </>
        )}
      </div>
    </div>
  )
}
