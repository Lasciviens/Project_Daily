import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { DateInput } from '../../../shared/components/DateInput'
import { Button, IconButton, SegmentedControl, cx } from '../../../shared/ui'
import {
  useAllPhases, useCreatePhase, useCreateProject, useDeletePhase, useDeleteProject, useProjects, useUpdatePhase, useUpdateProject,
} from '../hooks/useProjects'
import { AREA_LABEL, KIND_LABEL, STATUS_LABEL, STATUS_ORDER, TEMPLATES, nextSortOrder } from '../projectModel'
import { KIND_ICON } from '../projectIcons'
import type { PhaseStatus, Project, ProjectArea, ProjectKind, ProjectPhase, ProjectStatus } from '../types'

const AREA_OPTIONS = (['personal', 'work'] as const).map(value => ({ value, label: AREA_LABEL[value] }))

// ─── project ───────────────────────────────────────────────────────────────

/** `project`: a new project from a template (no id), or a project's details by id. */
export function ProjectEntityModal({ request, onClose }: EntityModalProps<'project'>) {
  const projectsQ = useProjects()
  const project = useFirstLoaded(request.id ? projectsQ.data?.find(p => p.id === request.id) : undefined, projectsQ)
  if (!request.id) return <NewProjectSheet onClose={onClose} />
  if (!project) return <EntityModalPending query={projectsQ} what="project" onClose={onClose} />
  return <ProjectDetailsSheet project={project} onClose={onClose} />
}

function NewProjectSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const create = useCreateProject()
  const [name, setName] = useState('')
  const [area, setArea] = useState<ProjectArea>('personal')
  const [kind, setKind] = useState<ProjectKind>('blank')

  async function save() {
    if (!name.trim()) return
    try {
      const p = await create.mutateAsync({ name: name.trim(), area, kind })
      onClose()
      navigate(`/projects/${p.id}`)
    } catch { /* the hook said what failed */ }
  }

  return (
    <ModalShell
      onClose={onClose}
      title="New project"
      size="md"
      dismissible={!create.isPending}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={create.isPending} disabled={!name.trim()}>Create project</Button>
        </div>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void save() }}>
        <div>
          <label htmlFor="np-name" className="field-label">Name</label>
          <input id="np-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120}
            placeholder="Kitchen scale, Bathroom, A course…" className="input max-w-md" />
        </div>
        <div>
          <span className="field-label">Area</span>
          <SegmentedControl options={AREA_OPTIONS} value={area} onChange={setArea} size="sm" />
        </div>
        <fieldset>
          <legend className="field-label">Start from</legend>
          <div className="grid grid-cols-1 gap-2 min-[25rem]:grid-cols-2">
            {TEMPLATES.map(t => {
              const Icon = KIND_ICON[t.kind]
              const on = kind === t.kind
              return (
                <button
                  key={t.kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setKind(t.kind)}
                  className={cx(
                    'flex min-h-[44px] items-start gap-2.5 rounded-row border p-2.5 text-left transition-colors',
                    on ? 'border-accent-500 bg-accent-50' : 'border-line bg-surface hover:bg-surface-hover',
                  )}
                >
                  <Icon aria-hidden className={cx('mt-0.5 h-4 w-4 shrink-0', on ? 'text-accent-600' : 'text-fg-muted')} />
                  <span className="min-w-0">
                    <span className="block text-ui text-fg">{t.label}</span>
                    <span className="block text-meta text-fg-muted">{t.summary}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-meta text-fg-muted">Every phase and block can be renamed, moved or removed later.</p>
        </fieldset>
      </form>
    </ModalShell>
  )
}

function ProjectDetailsSheet({ project, onClose }: { project: Project; onClose: () => void }) {
  const navigate = useNavigate()
  const update = useUpdateProject()
  const del = useDeleteProject()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [notes, setNotes] = useState(project.notes ?? '')
  const [status, setStatus] = useState<ProjectStatus>(project.status)
  const [kind, setKind] = useState<ProjectKind>(project.kind ?? 'blank')
  const [area, setArea] = useState<ProjectArea>(project.area ?? 'personal')
  const [startedOn, setStartedOn] = useState(project.started_on ?? '')
  const [targetOn, setTargetOn] = useState(project.target_on ?? '')
  const [link, setLink] = useState(project.link_url ?? '')
  const linkBad = !!link.trim() && !/^https?:\/\/\S+$/i.test(link.trim())

  async function save() {
    if (!name.trim() || linkBad) return
    try {
      await update.mutateAsync({ id: project.id, patch: {
        name: name.trim(), description: description.trim() || null, notes: notes.trim() || null, kind,
        started_on: startedOn || null, target_on: targetOn || null, link_url: link.trim() || null,
        // Only what changed, so the result says what happened ("Kitchen scale: On hold", "Project saved").
        ...(status !== project.status ? { status } : {}),
        ...(area !== (project.area ?? 'personal') ? { area } : {}),
      } })
      onClose()
    } catch { /* the hook said what failed */ }
  }

  async function remove() {
    const result = await del.run([project.id], {
      title: `Delete ${project.name}?`,
      message: 'Its phases, tasks, blocks and entries go with it.',
      done: `${project.name} deleted`,
    })
    if (result === 'deleted' || result === 'gone') { onClose(); navigate('/projects') }
  }

  return (
    <ModalShell
      onClose={onClose}
      title="Project details"
      size="md"
      dismissible={!update.isPending}
      footer={
        <div className="flex items-center gap-2">
          <IconButton label="Delete project" onClick={() => { void remove() }} className="hover:text-danger"><Trash2 /></IconButton>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={update.isPending} disabled={!name.trim() || linkBad}>Save</Button>
        </div>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void save() }}>
        <div>
          <label htmlFor="pd-name" className="field-label">Name</label>
          <input id="pd-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} className="input max-w-md" />
        </div>
        <div>
          <label htmlFor="pd-desc" className="field-label">What it is</label>
          <textarea id="pd-desc" value={description} onChange={e => setDescription(e.target.value)} rows={2}
            placeholder="One or two sentences about the goal" className="input min-h-[64px] resize-y" />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[26rem]:grid-cols-2">
          <div>
            <label htmlFor="pd-status" className="field-label">Status</label>
            <select id="pd-status" value={status} onChange={e => setStatus(e.target.value as ProjectStatus)} className="select">
              {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pd-kind" className="field-label">Kind</label>
            <select id="pd-kind" value={kind} onChange={e => setKind(e.target.value as ProjectKind)} className="select">
              {TEMPLATES.map(t => <option key={t.kind} value={t.kind}>{KIND_LABEL[t.kind]}</option>)}
            </select>
          </div>
          <div>
            <span className="field-label">Started</span>
            <DateInput value={startedOn} onChange={setStartedOn} aria-label="Started" />
          </div>
          <div>
            <span className="field-label">Target</span>
            <DateInput value={targetOn} onChange={setTargetOn} min={startedOn || undefined} aria-label="Target" />
          </div>
        </div>
        <div>
          <span className="field-label">Area</span>
          <SegmentedControl options={AREA_OPTIONS} value={area} onChange={setArea} size="sm" />
          {area !== (project.area ?? 'personal') && (
            <p className="mt-1 text-meta text-fg-muted">Its tasks move to {AREA_LABEL[area]} too.</p>
          )}
        </div>
        <div>
          <label htmlFor="pd-link" className="field-label">Main link</label>
          <input id="pd-link" value={link} onChange={e => setLink(e.target.value)} inputMode="url" placeholder="https://…"
            aria-invalid={linkBad} className="input max-w-md" />
          {linkBad && <p className="mt-1 text-meta text-danger">A link starts with https://</p>}
        </div>
        <div>
          <label htmlFor="pd-notes" className="field-label">Notes</label>
          <textarea id="pd-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            className="input min-h-[80px] resize-y" />
        </div>
      </form>
    </ModalShell>
  )
}

// ─── project-phase ─────────────────────────────────────────────────────────

const PHASE_STATUS_OPTIONS: Array<{ value: PhaseStatus; label: string }> = [
  { value: 'pending', label: 'Not started' }, { value: 'in_progress', label: 'In progress' }, { value: 'done', label: 'Done' },
]

/** `project-phase`: add a phase to a project, or edit one by id. */
export function ProjectPhaseEntityModal({ request, onClose }: EntityModalProps<'project-phase'>) {
  const phasesQ = useAllPhases()
  const phase = useFirstLoaded(request.id ? phasesQ.data?.find(p => p.id === request.id) : undefined, phasesQ)
  if (!phasesQ.data) return <EntityModalPending query={phasesQ} what="project" size="sm" onClose={onClose} />
  if (request.id && !phase) return <EntityModalPending query={phasesQ} what="phase" size="sm" onClose={onClose} />
  const siblings = phasesQ.data.filter(p => p.project_id === request.projectId)
  return <PhaseSheet projectId={request.projectId} phase={phase ?? null} siblings={siblings} onClose={onClose} />
}

function PhaseSheet({ projectId, phase, siblings, onClose }: {
  projectId: string; phase: ProjectPhase | null; siblings: ProjectPhase[]; onClose: () => void
}) {
  const create = useCreatePhase()
  const update = useUpdatePhase()
  const del = useDeletePhase()
  const [name, setName] = useState(phase?.name ?? '')
  const [doneWhen, setDoneWhen] = useState(phase?.done_when ?? '')
  const [targetOn, setTargetOn] = useState(phase?.target_on ?? '')
  const [status, setStatus] = useState<PhaseStatus>(phase?.status ?? 'pending')
  const saving = create.isPending || update.isPending

  async function save() {
    if (!name.trim()) return
    const fields = { name: name.trim(), done_when: doneWhen.trim() || null, target_on: targetOn || null }
    try {
      if (phase) await update.mutateAsync({ id: phase.id, patch: { ...fields, ...(status !== phase.status ? { status } : {}) } })
      else await create.mutateAsync({ input: { project_id: projectId, ...fields }, sortOrder: nextSortOrder(siblings) })
      onClose()
    } catch { /* the hook said what failed */ }
  }

  async function remove() {
    if (!phase) return
    const result = await del.run([phase.id], {
      title: `Delete ${phase.name}?`,
      message: 'Its tasks stay in the project, with no phase.',
      done: `${phase.name} deleted`,
    })
    if (result === 'deleted' || result === 'gone') onClose()
  }

  return (
    <ModalShell
      onClose={onClose}
      title={phase ? 'Edit phase' : 'New phase'}
      size="sm"
      dismissible={!saving}
      footer={
        <div className="flex items-center gap-2">
          {phase && <IconButton label="Delete phase" onClick={() => { void remove() }} className="hover:text-danger"><Trash2 /></IconButton>}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!name.trim()}>{phase ? 'Save' : 'Add phase'}</Button>
        </div>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void save() }}>
        <div>
          <label htmlFor="ph-name" className="field-label">Name</label>
          <input id="ph-name" autoFocus={!phase} value={name} onChange={e => setName(e.target.value)} maxLength={120}
            placeholder="Weighing on the bench" className="input" />
        </div>
        <div>
          <label htmlFor="ph-done" className="field-label">Done when</label>
          <textarea id="ph-done" value={doneWhen} onChange={e => setDoneWhen(e.target.value)} rows={2} maxLength={1000}
            placeholder="What has to be true to call this phase done" className="input min-h-[64px] resize-y" />
        </div>
        <div>
          <span className="field-label">Target</span>
          <DateInput value={targetOn} onChange={setTargetOn} aria-label="Target" className="max-w-[12rem]" />
        </div>
        {phase && (
          <div>
            <span className="field-label">Status</span>
            <SegmentedControl options={PHASE_STATUS_OPTIONS} value={status} onChange={setStatus} size="sm" />
          </div>
        )}
      </form>
    </ModalShell>
  )
}
