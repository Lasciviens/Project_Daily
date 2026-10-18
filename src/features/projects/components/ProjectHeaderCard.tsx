import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Disclosure, DisclosureButton, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ChevronDown, ExternalLink, LayoutGrid, MoreHorizontal, NotebookPen, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { HoverPeek } from '../../../shared/components/HoverPeek'
import { useEntityModal } from '../../../shared/modals'
import { Button, Card, IconButton, MetaLine, ProgressRing, cx } from '../../../shared/ui'
import { formatDate, formatDateTime } from '../../../shared/utils/dateFormat'
import type { Task } from '../../todo/types'
import { useDeleteProject, useUpdateProject } from '../hooks/useProjects'
import {
  AREA_LABEL, KIND_LABEL, STATUS_LABEL, STATUS_ORDER, linkLabel, progressValue, type ProjectSummary,
} from '../projectModel'
import { KIND_ICON } from '../projectIcons'
import { PROJECT_STATUS_TONE } from '../projectTones'
import { ProseText } from './ProseText'
import { DOTTED } from './peekStyle'
import type { Project, ProjectBlock, ProjectPhase } from '../types'


/**
 * The project's top: its name and status, then where it stands (the status
 * line — its date on hover or tap), the numbers that matter and the main
 * actions. What it is (description, kind, dates, notes) waits behind About.
 */
export function ProjectHeaderCard({ project, summary, current, logBlock, onNewTask }: {
  project: Project
  summary: ProjectSummary<Task>
  current: ProjectPhase | null
  logBlock: ProjectBlock | null
  onNewTask: () => void
}) {
  const modal = useEntityModal()
  const navigate = useNavigate()
  const update = useUpdateProject()
  const del = useDeleteProject()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const Icon = KIND_ICON[project.kind ?? 'blank']
  const value = progressValue(summary)

  function startEdit() {
    setDraft(project.status_line ?? '')
    setEditing(true)
  }
  async function saveStatusLine() {
    const next = draft.trim()
    setEditing(false)
    if (next === (project.status_line ?? '')) return
    try { await update.mutateAsync({ id: project.id, patch: { status_line: next || null } }) } catch { /* the hook said what failed */ }
  }
  async function remove() {
    const result = await del.run([project.id], {
      title: `Delete ${project.name}?`, message: 'Its phases, tasks, blocks and entries go with it.', done: `${project.name} deleted`,
    })
    if (result === 'deleted' || result === 'gone') navigate('/projects')
  }

  const facts = [
    KIND_LABEL[project.kind ?? 'blank'], AREA_LABEL[project.area ?? 'personal'],
    project.started_on && `Started ${formatDate(project.started_on)}`,
    project.target_on && `Target ${formatDate(project.target_on)}`,
  ]

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-5 [&_svg]:w-5">
          <Icon />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-title font-semibold text-fg">{project.name}</h1>
          <Menu as="div" className="mt-0.5">
            <MenuButton data-tone={PROJECT_STATUS_TONE[project.status]} className="tone-pill gap-1" aria-label={`Status: ${STATUS_LABEL[project.status]} — change`}>
              {STATUS_LABEL[project.status]}<ChevronDown aria-hidden className="h-3 w-3" />
            </MenuButton>
            <MenuItems anchor="bottom start" transition className="menu w-40 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
              {STATUS_ORDER.map(s => (
                <MenuItem key={s}>
                  <button type="button" className="menu-item" aria-current={s === project.status || undefined}
                    onClick={() => { if (s !== project.status) void update.mutateAsync({ id: project.id, patch: { status: s } }).catch(() => undefined) }}>
                    {STATUS_LABEL[s]}
                  </button>
                </MenuItem>
              ))}
            </MenuItems>
          </Menu>
        </div>
        <Menu as="div" className="shrink-0">
          <MenuButton className="icon-btn" aria-label="More for this project" title="More for this project">
            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
          </MenuButton>
          <MenuItems anchor="bottom end" transition className="menu w-48 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
            <MenuItem>
              <button type="button" className="menu-item" onClick={() => modal.open({ kind: 'project', id: project.id })}>
                <Settings2 aria-hidden className="h-4 w-4" /> Project details
              </button>
            </MenuItem>
            <MenuItem>
              <button type="button" className="menu-item" onClick={() => modal.open({ kind: 'project-phase', projectId: project.id })}>
                <Plus aria-hidden className="h-4 w-4" /> Add a phase
              </button>
            </MenuItem>
            <div className="menu-sep" />
            <MenuItem>
              <button type="button" className="menu-item is-danger" onClick={() => { void remove() }}>
                <Trash2 aria-hidden className="h-4 w-4" /> Delete project
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>

      <Disclosure>
        {({ open }) => (
          <div>
            <DisclosureButton className="flex items-center gap-1 text-meta font-semibold text-fg-muted hover:text-fg">
              <ChevronDown aria-hidden className={cx('h-3.5 w-3.5 transition-transform motion-reduce:transition-none', open ? '' : '-rotate-90')} />
              About
            </DisclosureButton>
            <DisclosurePanel className="mt-1.5 flex flex-col gap-1.5">
              {project.description && <p className="whitespace-pre-line text-body text-fg-2">{project.description}</p>}
              <MetaLine className="text-meta text-fg-muted" items={facts} />
              {project.notes && <ProseText text={project.notes} className="border-t border-line pt-1.5" />}
              {!project.description && !project.notes && (
                <button type="button" onClick={() => modal.open({ kind: 'project', id: project.id })}
                  className="self-start text-meta font-semibold text-accent-600">Add what it is</button>
              )}
            </DisclosurePanel>
          </div>
        )}
      </Disclosure>

      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void saveStatusLine() }}>
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={200} aria-label="Status line"
            placeholder="Where it stands, in one line" className="input input-sm min-w-0 flex-1 basis-56"
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }} />
          <Button size="sm" variant="primary" type="submit">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      ) : project.status_line ? (
        <div className="flex items-start gap-2 rounded-row bg-surface-2 py-1.5 pl-3 pr-1">
          <HoverPeek trigger={project.status_line} className={cx(DOTTED, 'min-w-0 flex-1 py-1 text-body font-medium text-fg-2')} panelClassName="w-auto">
            {project.status_line_at ? `Updated ${formatDateTime(project.status_line_at)}` : 'Not dated'}
          </HoverPeek>
          <IconButton label="Change the status line" onClick={startEdit} className="shrink-0"><Pencil /></IconButton>
        </div>
      ) : (
        <button type="button" onClick={startEdit} className="self-start text-meta font-semibold text-accent-600">+ Status line</button>
      )}

      <div className="flex items-center gap-3">
        <ProgressRing value={value} size={52} stroke={6} color="rgb(var(--accent-500))" className="h-[52px] w-[52px] shrink-0">
          <span className="text-meta font-semibold tabular-nums text-fg">{summary.phasesTotal ? `${summary.phasesDone}/${summary.phasesTotal}` : `${Math.round(value * 100)}%`}</span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="section-label">
            {current ? `Now · Phase ${summary.currentIndex} of ${summary.phasesTotal}` : summary.phasesTotal ? 'Every phase done' : 'No phases yet'}
          </p>
          {current && (
            current.done_when
              ? <HoverPeek trigger={current.name} className={cx(DOTTED, 'text-ui text-fg')} panelClassName="w-72">
                  <span className="font-semibold text-fg">Done when:</span> {current.done_when}
                </HoverPeek>
              : <p className="break-words text-ui text-fg">{current.name}</p>
          )}
          <MetaLine className="text-meta text-fg-muted" items={[
            summary.tasksTotal > 0 && `${summary.tasksDone} of ${summary.tasksTotal} tasks done`,
            summary.openQuestions > 0 && (
              <span className="font-semibold text-warn">{summary.openQuestions} open question{summary.openQuestions === 1 ? '' : 's'}</span>
            ),
          ]} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" icon={<Plus />} onClick={onNewTask}>Task</Button>
        {logBlock && (
          <Button size="sm" icon={<NotebookPen />} onClick={() => modal.open({ kind: 'project-entry', projectId: project.id, blockId: logBlock.id })}>
            Log entry
          </Button>
        )}
        <Button size="sm" icon={<LayoutGrid />} onClick={() => modal.open({ kind: 'project-block', projectId: project.id })}>Block</Button>
        {project.link_url && (
          <a href={project.link_url} target="_blank" rel="noreferrer noopener" className="btn-ghost btn-sm max-w-full">
            <ExternalLink aria-hidden className="h-4 w-4 shrink-0" />
            <span className="truncate">{linkLabel(project.link_url).split('/')[0]}</span>
          </a>
        )}
      </div>
    </Card>
  )
}
