import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { DateInput } from '../../../shared/components/DateInput'
import { Button, IconButton, SegmentedControl } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useBlocks, useCreateEntry, useDeleteEntry, useEntries, useUpdateEntry } from '../hooks/useProjects'
import { decide, nextSortOrder, parseCell, rowTitle, tableSettings } from '../projectModel'
import { ProseText } from '../components/ProseText'
import type { EntryFields, EntryState, ProjectBlock, ProjectEntry, TableColumn } from '../types'

/** `project-entry`: add an entry to a block, or open one by id (a page opens to read; Edit turns it into the form). */
export function ProjectEntryEntityModal({ request, onClose }: EntityModalProps<'project-entry'>) {
  const blocksQ = useBlocks(request.projectId)
  const entriesQ = useEntries(request.projectId)
  const block = blocksQ.data?.find(b => b.id === request.blockId)
  const entry = useFirstLoaded(request.id ? entriesQ.data?.find(e => e.id === request.id) : undefined, entriesQ)
  if (!block) return <EntityModalPending query={blocksQ} what="block" size="sm" onClose={onClose} />
  if (!entriesQ.data) return <EntityModalPending query={entriesQ} what="block" size="sm" onClose={onClose} />
  if (request.id && !entry) return <EntityModalPending query={entriesQ} what="entry" size="sm" onClose={onClose} />
  const siblings = entriesQ.data.filter(e => e.block_id === block.id)
  return <EntrySheet block={block} entry={entry ?? null} siblings={siblings} onClose={onClose} />
}

const NOUN: Record<ProjectBlock['kind'], string> = { table: 'row', log: 'log entry', decisions: 'question', pages: 'page', links: 'link' }

function EntrySheet({ block, entry, siblings, onClose }: {
  block: ProjectBlock; entry: ProjectEntry | null; siblings: ProjectEntry[]; onClose: () => void
}) {
  const create = useCreateEntry()
  const update = useUpdateEntry()
  const del = useDeleteEntry(block.project_id)
  const settings = tableSettings(block.settings)
  const [reading, setReading] = useState(block.kind === 'pages' && !!entry)
  const [title, setTitle] = useState(entry?.title ?? '')
  const [body, setBody] = useState(entry?.body ?? '')
  const [url, setUrl] = useState(entry?.url ?? '')
  const [day, setDay] = useState(entry?.entry_date ?? (block.kind === 'log' ? todayStr() : ''))
  const [state, setState] = useState<EntryState>(entry?.state ?? 'open')
  const [cells, setCells] = useState<Record<string, string | boolean>>(() => {
    const out: Record<string, string | boolean> = {}
    for (const c of settings.columns) {
      const v = entry?.data[c.key]
      out[c.key] = c.type === 'check' ? v === true : v == null ? '' : String(v)
    }
    return out
  })
  const [tried, setTried] = useState(false)
  const saving = create.isPending || update.isPending

  const parsed = settings.columns.map(c => ({ column: c, result: parseCell(c, cells[c.key] ?? '') }))
  const cellErrors = parsed.flatMap(p => (p.result.ok ? [] : [p.result.error]))
  const urlBad = block.kind === 'links' && !/^https?:\/\/\S+$/i.test(url.trim())
  const needsTitle = block.kind !== 'table' && block.kind !== 'log'
  const problem = block.kind === 'table' ? cellErrors[0] ?? null
    : block.kind === 'links' && urlBad ? 'A link starts with https://'
    : needsTitle && !title.trim() ? 'It needs a title.'
    : block.kind === 'log' && !title.trim() && !body.trim() ? 'Write what happened.'
    : null

  function fields(): EntryFields {
    switch (block.kind) {
      case 'table': {
        // Keeps the values of columns this table no longer shows (a removed column).
        const data: Record<string, unknown> = { ...(entry?.data ?? {}) }
        for (const p of parsed) if (p.result.ok) {
          if (p.result.value === null || p.result.value === false) delete data[p.column.key]
          else data[p.column.key] = p.result.value
        }
        return { data }
      }
      case 'log': return { title: title.trim() || null, body: body || null, entry_date: day || todayStr() }
      case 'decisions': {
        if (state === 'decided') return { title: title.trim(), body: body || null, ...decide({ entry_date: day || null }, todayStr()) }
        return { title: title.trim(), body: body || null, state: 'open', entry_date: null }
      }
      case 'links': return { title: title.trim(), url: url.trim(), body: body || null }
      default: return { title: title.trim(), body: body || null }
    }
  }

  function message(): string {
    if (block.kind === 'decisions') {
      if (!entry) return state === 'decided' ? 'Decision added' : 'Question added'
      return entry.state !== 'decided' && state === 'decided' ? 'Decided' : 'Saved'
    }
    const noun = NOUN[block.kind]
    return entry ? `${noun[0].toUpperCase()}${noun.slice(1)} saved` : `${noun[0].toUpperCase()}${noun.slice(1)} added`
  }

  async function save() {
    setTried(true)
    if (problem) return
    try {
      if (entry) await update.mutateAsync({ id: entry.id, fields: fields(), message: message() })
      else await create.mutateAsync({ block, fields: { ...fields(), sort_order: nextSortOrder(siblings) }, message: message() })
      onClose()
    } catch { /* the hook said what failed */ }
  }

  async function remove() {
    if (!entry) return
    const name = block.kind === 'table' ? rowTitle(settings, entry.data) : entry.title || NOUN[block.kind]
    const result = await del.run([entry.id], { title: `Delete ${name}?`, done: `${name} deleted` })
    if (result === 'deleted' || result === 'gone') onClose()
  }

  const heading = entry
    ? (block.kind === 'table' ? rowTitle(settings, entry.data) : entry.title || block.title)
    : `New ${block.kind === 'decisions' && state === 'decided' ? 'decision' : NOUN[block.kind]}`

  if (reading && entry) {
    return (
      <ModalShell onClose={onClose} title={entry.title || block.title} subtitle={block.title} size="lg"
        headerActions={<IconButton label="Edit page" onClick={() => setReading(false)}><Pencil /></IconButton>}>
        {entry.body ? <ProseText text={entry.body} /> : <p className="text-body text-fg-muted">This page is empty. Edit it to write it.</p>}
      </ModalShell>
    )
  }

  return (
    <ModalShell
      onClose={onClose}
      title={heading}
      subtitle={block.title}
      size={block.kind === 'pages' ? 'lg' : 'sm'}
      mobile={block.kind === 'pages' ? 'fullscreen' : 'sheet'}
      dismissible={!saving}
      footer={
        <div className="flex items-center gap-2">
          {entry && <IconButton label={`Delete ${NOUN[block.kind]}`} onClick={() => { void remove() }} className="hover:text-danger"><Trash2 /></IconButton>}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>{entry ? 'Save' : 'Add'}</Button>
        </div>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void save() }}>
        {block.kind === 'table' && settings.columns.map((c, i) => (
          <CellField key={c.key} column={c} value={cells[c.key] ?? ''} autoFocus={i === 0 && !entry}
            onChange={v => setCells(cs => ({ ...cs, [c.key]: v }))} />
        ))}

        {block.kind === 'decisions' && (
          <SegmentedControl size="sm" value={state} onChange={setState}
            options={[{ value: 'open', label: 'Open question' }, { value: 'decided', label: 'Decided' }]} />
        )}

        {block.kind === 'log' && (
          <div>
            <span className="field-label">Day</span>
            <DateInput value={day} onChange={setDay} aria-label="Day" className="max-w-[12rem]" />
          </div>
        )}

        {block.kind !== 'table' && (
          <div>
            <label htmlFor="pe-title" className="field-label">
              {block.kind === 'decisions' ? (state === 'decided' ? 'Decision' : 'Question') : block.kind === 'log' ? 'What happened' : 'Title'}
            </label>
            <input id="pe-title" autoFocus={!entry} value={title} onChange={e => setTitle(e.target.value)} maxLength={300} className="input" />
          </div>
        )}

        {block.kind === 'links' && (
          <div>
            <label htmlFor="pe-url" className="field-label">Address</label>
            <input id="pe-url" value={url} onChange={e => setUrl(e.target.value)} inputMode="url" placeholder="https://…" className="input" />
          </div>
        )}

        {block.kind !== 'table' && (
          <div>
            <label htmlFor="pe-body" className="field-label">
              {block.kind === 'decisions' ? (state === 'decided' ? 'Why' : 'Details') : block.kind === 'links' ? 'Note' : block.kind === 'pages' ? 'Text' : 'Details'}
            </label>
            <textarea id="pe-body" value={body} onChange={e => setBody(e.target.value)}
              rows={block.kind === 'pages' ? 16 : 4} maxLength={50000}
              className={block.kind === 'pages' ? 'input min-h-[50dvh] resize-y font-mono text-meta' : 'input min-h-[96px] resize-y'} />
            {block.kind === 'pages' && (
              <p className="mt-1 text-meta text-fg-muted"># heading · - list · 1. steps · ``` code ``` · **bold** · links</p>
            )}
          </div>
        )}

        {block.kind === 'decisions' && state === 'decided' && (
          <div>
            <span className="field-label">Decided on</span>
            <DateInput value={day} onChange={setDay} aria-label="Decided on" className="max-w-[12rem]" />
            {!day && <p className="mt-1 text-meta text-fg-muted">Today ({formatDate(todayStr())}) when left empty.</p>}
          </div>
        )}

        {tried && problem && <p className="text-meta text-danger">{problem}</p>}
      </form>
    </ModalShell>
  )
}

function CellField({ column, value, autoFocus, onChange }: {
  column: TableColumn; value: string | boolean; autoFocus: boolean; onChange: (v: string | boolean) => void
}) {
  const id = `pe-cell-${column.key}`
  if (column.type === 'check') {
    return (
      <label className="flex min-h-[44px] items-center gap-2 text-body text-fg">
        <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-accent-500" />
        {column.label}
      </label>
    )
  }
  return (
    <div>
      {column.type === 'date'
        ? <span className="field-label">{column.label}</span>
        : <label htmlFor={id} className="field-label">{column.label}</label>}
      {column.type === 'status' ? (
        <select id={id} value={String(value)} onChange={e => onChange(e.target.value)} className="select max-w-md">
          <option value="">—</option>
          {(column.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : column.type === 'date' ? (
        <DateInput value={String(value)} onChange={onChange} aria-label={column.label} className="max-w-[12rem]" />
      ) : (
        <input id={id} autoFocus={autoFocus} value={String(value)} onChange={e => onChange(e.target.value)}
          inputMode={column.type === 'number' || column.type === 'money' ? 'decimal' : column.type === 'link' ? 'url' : undefined}
          placeholder={column.type === 'link' ? 'https://…' : undefined}
          className={column.type === 'number' || column.type === 'money' ? 'input max-w-[12rem] tabular-nums' : 'input'} />
      )}
    </div>
  )
}
