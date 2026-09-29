import { useState, type ReactNode } from 'react'
import { ChevronLeft, Plus } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, PageBoard, SegmentedControl, Skeleton } from '../../../shared/ui'
import { PhaseCard } from './PhaseCard'
import { PhaseColumns } from './PhaseColumns'
import { ProjectBoard } from './ProjectBoard'
import { ProjectHeaderCard } from './ProjectHeaderCard'
import { ProjectNotesCard } from './ProjectNotesCard'
import { ProjectActivityFeed } from './ProjectActivityFeed'
import { ITEM_TYPE_LABEL, ITEM_TYPE_ORDER } from '../projectTones'
import {
  usePhases, useItems, useUpdateProject,
  useCreatePhase, useUpdatePhase, useDeletePhase,
  useUpdateItem, useDeleteItem,
} from '../hooks/useProjects'
import type { Project, ItemType } from '../types'
import { projectLayout, type ProjectSection } from '../projectBoard'

interface Props {
  project:  Project
  onBack:   () => void
  onDelete: () => void
}

export function ProjectDetail({ project, onBack, onDelete }: Props) {
  const [typeFilter, setTypeFilter] = useState<ItemType | null>(null)
  const [view, setView] = useState<'phases' | 'board'>('phases')
  const modal = useEntityModal()

  const { data: phases = [], isLoading: phasesLoading } = usePhases(project.id)
  const { data: allItems = [] } = useItems(project.id)

  const updateProject = useUpdateProject()
  const createPhase   = useCreatePhase(project.id)
  const updatePhase   = useUpdatePhase(project.id)
  const deletePhase   = useDeletePhase(project.id)
  const updateItem    = useUpdateItem(project.id)
  const deleteItem    = useDeleteItem(project.id)

  const typeCounts = ITEM_TYPE_ORDER.map(type => ({ type, count: allItems.filter(i => i.type === type).length }))
    .filter(t => t.count > 0)

  const sections: Record<ProjectSection, ReactNode> = {
    back: (
      <Button variant="ghost" size="sm" icon={<ChevronLeft />} onClick={onBack} className="-ml-3 self-start">
        Projects
      </Button>
    ),
    header: <ProjectHeaderCard project={project} items={allItems} onDeleted={onDelete} />,
    controls: (
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<'phases' | 'board'>
          value={view}
          onChange={setView}
          options={[{ value: 'phases', label: 'Phases' }, { value: 'board', label: 'Board' }]}
        />
        {view === 'phases' && typeCounts.length > 0 && (
          <div role="group" aria-label="Filter by type" className="scroll-x flex w-full gap-1 sm:w-auto">
            <button type="button" aria-pressed={typeFilter === null} onClick={() => setTypeFilter(null)} className="pill-tab shrink-0">
              All
            </button>
            {typeCounts.map(({ type, count }) => (
              <button
                key={type}
                type="button"
                aria-pressed={typeFilter === type}
                onClick={() => setTypeFilter(t => (t === type ? null : type))}
                className="pill-tab shrink-0 capitalize"
              >
                {ITEM_TYPE_LABEL[type]} <span className="count-badge">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    ),
    items: view === 'phases' ? (
      // Phases in column stacks dealt by index; the column count follows
      // this area's own width (PhaseColumns, projectBoard.ts).
      <PhaseColumns
        items={phasesLoading
          ? [1, 2].map(i => ({ key: `skeleton-${i}`, node: <Skeleton rounded="rounded-card" className="h-14" /> }))
          : [
              ...phases.map(phase => ({
                key: phase.id,
                node: (
                  <PhaseCard
                    phase={phase}
                    items={allItems.filter(i => i.phase_id === phase.id)}
                    typeFilter={typeFilter}
                    onUpdatePhase={patch => updatePhase.mutate({ id: phase.id, patch })}
                    onDeletePhase={() => deletePhase.mutate(phase.id)}
                    onAddItem={() => modal.open({ kind: 'project-item', projectId: project.id, phaseId: phase.id })}
                    onUpdateItem={(itemId, patch) => updateItem.mutate({ id: itemId, patch })}
                    onDeleteItem={itemId => deleteItem.mutate(itemId)}
                    onEditItem={item => modal.open({ kind: 'project-item', projectId: project.id, id: item.id })}
                  />
                ),
              })),
              {
                key: 'add-phase',
                node: (
                  <button
                    type="button"
                    onClick={() => createPhase.mutate({ project_id: project.id, name: 'New phase' })}
                    disabled={createPhase.isPending}
                    className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-line-strong text-body font-medium text-fg-muted transition-colors hover:border-accent-500 hover:text-accent-600 disabled:opacity-50"
                  >
                    <Plus aria-hidden className="h-4 w-4" /> Add phase
                  </button>
                ),
              },
            ]}
      />
    ) : (
      <ProjectBoard
        projectId={project.id}
        items={allItems}
        phases={phases}
        onMove={(id, status) => updateItem.mutate({ id, patch: { status } })}
      />
    ),
    notes: (
      <ProjectNotesCard
        notes={project.notes}
        onSave={notes => updateProject.mutateAsync({ id: project.id, patch: { notes } })}
      />
    ),
    activity: (
      <ProjectActivityFeed
        projectId={project.id}
        itemIds={allItems.map(i => i.id)}
        phaseIds={phases.map(p => p.id)}
      />
    ),
  }

  // Which card goes where at each width: projectBoard.ts.
  return <PageBoard sections={sections} layout={projectLayout(view)} stackGap="gap-4" />
}
