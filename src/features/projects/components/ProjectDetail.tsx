import { useState } from 'react'
import { InlineText } from './InlineText'
import { InlineTextArea } from './InlineTextArea'
import { StatusCycleChip, PROJECT_STATUS_COLORS } from './StatusCycleChip'
import { PhaseCard } from './PhaseCard'
import { ProjectItemModal } from './ProjectItemModal'
import {
  usePhases, useItems,
  useUpdateProject, useDeleteProject,
  useCreatePhase, useUpdatePhase, useDeletePhase,
  useUpdateItem, useDeleteItem,
} from '../hooks/useProjects'
import type { Project, ProjectStatus, ItemType, ItemStatus, ProjectItem } from '../types'

const PROJECT_STATUSES: ProjectStatus[] = ['active', 'on_hold', 'completed', 'archived']

const COLOR_DOT: Record<string, string> = {
  slate: 'bg-slate-400', blue: 'bg-blue-400', violet: 'bg-violet-400',
  emerald: 'bg-emerald-400', amber: 'bg-amber-400', rose: 'bg-rose-400',
}
const COLORS = ['slate', 'blue', 'violet', 'emerald', 'amber', 'rose'] as const

const TYPE_FILTERS: Array<{ type: ItemType; label: string; cls: string }> = [
  { type: 'update',      label: 'update',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { type: 'improvement', label: 'improve', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { type: 'ui_request',  label: 'UI',      cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  { type: 'bug',         label: 'bug',     cls: 'bg-red-50 text-red-700 border-red-200' },
  { type: 'wishlist',    label: 'wish',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
]

const TYPE_BADGE: Record<ItemType, string> = {
  update:      'bg-blue-50 text-blue-700 border-blue-200',
  improvement: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ui_request:  'bg-violet-50 text-violet-700 border-violet-200',
  bug:         'bg-red-50 text-red-700 border-red-200',
  wishlist:    'bg-amber-50 text-amber-700 border-amber-200',
}
const TYPE_LABEL: Record<ItemType, string> = {
  update: 'update', improvement: 'improve', ui_request: 'UI', bug: 'bug', wishlist: 'wish',
}
const PRIORITY_DOT = { low: 'bg-ink-300', medium: 'bg-accent-400', high: 'bg-red-400' } as const

const BOARD_COLUMNS: Array<{ key: ItemStatus; label: string; accent: string }> = [
  { key: 'open',        label: 'To do',       accent: 'text-ink-500' },
  { key: 'in_progress', label: 'In progress', accent: 'text-accent-600' },
  { key: 'done',        label: 'Done',        accent: 'text-emerald-600' },
]

interface Props {
  project:  Project
  onBack:   () => void
  onDelete: () => void
}

export function ProjectDetail({ project, onBack, onDelete }: Props) {
  const [typeFilter, setTypeFilter] = useState<ItemType | null>(null)
  const [view, setView] = useState<'phases' | 'board'>('phases')
  const [itemModal, setItemModal] = useState<{ phaseId?: string; item?: ProjectItem } | null>(null)

  const { data: phases = [], isLoading: phasesLoading } = usePhases(project.id)
  const { data: allItems = [] }                          = useItems(project.id)

  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const createPhase   = useCreatePhase(project.id)
  const updatePhase   = useUpdatePhase(project.id)
  const deletePhase   = useDeletePhase(project.id)
  const updateItem    = useUpdateItem(project.id)
  const deleteItem    = useDeleteItem(project.id)

  const total     = allItems.length
  const doneCount = allItems.filter(i => i.status === 'done').length
  const wipCount  = allItems.filter(i => i.status === 'in_progress').length
  const pct       = total > 0 ? Math.round((doneCount / total) * 100) : 0

  const phaseName = (id: string) => phases.find(p => p.id === id)?.name ?? '—'

  async function handleDeleteProject() {
    if (!confirm(`Delete "${project.name}"? This will remove all phases and items.`)) return
    await deleteProject.mutateAsync(project.id)
    onDelete()
  }

  function handleAddPhase() { createPhase.mutate({ project_id: project.id, name: 'New phase' }) }

  function moveItem(item: ProjectItem, dir: -1 | 1) {
    const order: ItemStatus[] = ['open', 'in_progress', 'done']
    const idx = order.indexOf(item.status as ItemStatus)
    const next = order[Math.min(order.length - 1, Math.max(0, (idx === -1 ? 0 : idx) + dir))]
    if (next !== item.status) updateItem.mutate({ id: item.id, patch: { status: next } })
  }

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        className="self-start min-h-[44px] -ml-1 px-2 inline-flex items-center gap-1 text-sm text-ink-700 hover:text-ink-900 transition-colors"
      >
        ← Projects
      </button>

      {/* Header card */}
      <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full shrink-0 ${COLOR_DOT[project.color] ?? 'bg-ink-300'}`} />
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
            className="min-w-[44px] min-h-[44px] ml-auto flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors disabled:opacity-40"
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

        {/* Overall progress */}
        <div className="flex flex-col gap-1.5">
          <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-ink-500">
            <span>{total > 0 ? `${doneCount}/${total} done` : 'No items yet'}</span>
            <span className="flex items-center gap-2">
              {wipCount > 0 && <span className="text-accent-600 font-medium">{wipCount} in progress</span>}
              {total > 0 && <span className="font-semibold text-ink-700">{pct}%</span>}
            </span>
          </div>
        </div>

        {/* Color picker */}
        <div className="flex gap-1">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => updateProject.mutate({ id: project.id, patch: { color: c } })}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center lg:min-w-0 lg:min-h-0 lg:w-6 lg:h-6"
              title={c}
            >
              <span className={`w-4 h-4 rounded-full ${COLOR_DOT[c]} transition-transform hover:scale-110 ${
                project.color === c ? 'ring-2 ring-offset-1 ring-ink-400' : ''
              }`} />
            </button>
          ))}
        </div>
      </div>

      {/* View toggle + type filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-0.5 p-0.5 bg-white border border-ink-200 rounded-lg">
          {(['phases', 'board'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 min-h-[44px] rounded-md text-xs font-semibold transition-colors ${
                view === v ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              {v === 'phases' ? 'Phases' : 'Board'}
            </button>
          ))}
        </div>

        {view === 'phases' && total > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setTypeFilter(null)}
              className={`text-[10px] px-2 min-h-[44px] rounded border transition-colors ${
                typeFilter === null ? 'bg-ink-800 text-white border-ink-800' : 'bg-white text-ink-500 border-ink-200 hover:border-ink-400'
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
                  className={`text-[10px] px-2 min-h-[44px] rounded border transition-colors ${
                    typeFilter === f.type ? f.cls + ' font-semibold' : 'bg-white text-ink-500 border-ink-200 hover:border-ink-400'
                  }`}
                >
                  {f.label} {count}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Phases view ─── */}
      {view === 'phases' && (
        <div className="space-y-3">
          {phasesLoading ? (
            [1, 2].map(i => <div key={i} className="h-12 bg-white/50 rounded-xl animate-pulse" />)
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
                  onAddItem={() => setItemModal({ phaseId: phase.id })}
                  onUpdateItem={(itemId, patch) => updateItem.mutate({ id: itemId, patch })}
                  onDeleteItem={itemId => deleteItem.mutate(itemId)}
                  onEditItem={item => setItemModal({ item })}
                />
              ))}
              <button
                onClick={handleAddPhase}
                disabled={createPhase.isPending}
                className="w-full text-xs text-ink-500 hover:text-accent-600 min-h-[44px] py-2 rounded-xl border border-dashed border-ink-300 hover:border-accent-300 bg-white/40 transition-colors"
              >
                + Add phase
              </button>
            </>
          )}
        </div>
      )}

      {/* ─── Board view ─── */}
      {view === 'board' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          {BOARD_COLUMNS.map((col, colIdx) => {
            const items = allItems.filter(i => i.status === col.key)
            return (
              <div key={col.key} className="bg-white/60 border border-ink-200 rounded-2xl p-2.5 flex flex-col gap-2 min-h-[80px]">
                <div className="flex items-center justify-between px-1">
                  <span className={`text-[11px] font-bold uppercase tracking-wide ${col.accent}`}>{col.label}</span>
                  <span className="text-[11px] text-ink-400">{items.length}</span>
                </div>
                {items.length === 0 && <p className="text-[11px] text-ink-300 px-1 py-2">Empty</p>}
                {items.map(item => (
                  <div key={item.id} className="bg-white border border-ink-100 rounded-xl p-2.5 flex flex-col gap-1.5 shadow-card">
                    <button
                      type="button"
                      onClick={() => setItemModal({ item })}
                      className={`text-sm leading-snug text-left hover:bg-ink-50 rounded px-0.5 -mx-0.5 transition-colors ${item.status === 'done' ? 'line-through text-ink-400' : 'text-ink-800'}`}
                    >
                      {item.title}
                    </button>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${TYPE_BADGE[item.type]}`}>{TYPE_LABEL[item.type]}</span>
                      <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[item.priority]}`} title={`priority: ${item.priority}`} />
                      <span className="text-[10px] text-ink-400 truncate">{phaseName(item.phase_id)}</span>
                      <div className="ml-auto flex items-center gap-0.5">
                        {colIdx > 0 && (
                          <button onClick={() => moveItem(item, -1)} className="min-h-[44px] min-w-[28px] lg:min-h-0 lg:w-6 lg:h-6 flex items-center justify-center text-ink-400 hover:text-ink-700 rounded" title="Move left">←</button>
                        )}
                        {colIdx < BOARD_COLUMNS.length - 1 && (
                          <button onClick={() => moveItem(item, 1)} className="min-h-[44px] min-w-[28px] lg:min-h-0 lg:w-6 lg:h-6 flex items-center justify-center text-ink-400 hover:text-accent-600 rounded" title="Move right">→</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {view === 'board' && (() => {
        const cancelledCount = allItems.filter(i => i.status === 'cancelled').length
        // Board columns are open/in_progress/done only (arrow nav cycles through
        // just those three) — cancelled items are real but intentionally hidden
        // here rather than silently missing; they're still visible in Phases view.
        return cancelledCount > 0 ? (
          <p className="text-[11px] text-ink-400 mt-2">{cancelledCount} cancelled item{cancelledCount === 1 ? '' : 's'} hidden from board — see Phases view</p>
        ) : null
      })()}

      {/* Add / edit item modal */}
      {itemModal && (
        <ProjectItemModal
          open
          onClose={() => setItemModal(null)}
          projectId={project.id}
          phases={phases}
          defaultPhaseId={itemModal.phaseId}
          item={itemModal.item}
        />
      )}
    </div>
  )
}
