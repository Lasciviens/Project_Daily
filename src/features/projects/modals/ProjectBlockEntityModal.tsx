import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, IconButton, cx } from '../../../shared/ui'
import { SHOP_CURRENCIES } from '../../shop/shopModel'
import { useBlocks, useCreateBlock, useDeleteBlock, useEntries, useUpdateBlock } from '../hooks/useProjects'
import {
  BLOCK_KINDS, BLOCK_KIND_HINT, BLOCK_KIND_LABEL, COLUMN_TYPES, COLUMN_TYPE_LABEL,
  cleanOptions, defaultTableSettings, newColumnKey, nextSortOrder, tableSettings,
} from '../projectModel'
import { BLOCK_ICON } from '../projectIcons'
import type { BlockKind, ColumnType, ProjectBlock, TableColumn, TableSettings } from '../types'

const DEFAULT_TITLE: Record<BlockKind, string> = {
  table: 'Table', log: 'Log', decisions: 'Questions and decisions', pages: 'Notes', links: 'Links',
}

/** `project-block`: add a block to a project, or edit one by id (a table's columns live here). */
export function ProjectBlockEntityModal({ request, onClose }: EntityModalProps<'project-block'>) {
  const blocksQ = useBlocks(request.projectId)
  const block = useFirstLoaded(request.id ? blocksQ.data?.find(b => b.id === request.id) : undefined, blocksQ)
  if (!blocksQ.data) return <EntityModalPending query={blocksQ} what="project" size="sm" onClose={onClose} />
  if (request.id && !block) return <EntityModalPending query={blocksQ} what="block" size="sm" onClose={onClose} />
  return (
    <BlockSheet projectId={request.projectId} block={block ?? null} siblings={blocksQ.data}
      initialKind={request.blockKind ?? null} onClose={onClose} />
  )
}

/** A column while it is being edited: choices as typed text. A new one gets
 *  its key from its name on save, so a removed column added back under the
 *  same name finds its old values again. */
interface ColumnDraft { key: string; label: string; type: ColumnType; options: string; fresh?: boolean }

const toDraft = (c: TableColumn): ColumnDraft => ({ key: c.key, label: c.label, type: c.type, options: (c.options ?? []).join(', ') })

function BlockSheet({ projectId, block, siblings, initialKind, onClose }: {
  projectId: string; block: ProjectBlock | null; siblings: ProjectBlock[]; initialKind: BlockKind | null; onClose: () => void
}) {
  const create = useCreateBlock()
  const update = useUpdateBlock()
  const del = useDeleteBlock(projectId)
  const entriesQ = useEntries(block ? projectId : null)
  const [kind, setKind] = useState<BlockKind | null>(block?.kind ?? initialKind)
  const [title, setTitle] = useState(block?.title ?? (initialKind ? DEFAULT_TITLE[initialKind] : ''))
  const start: TableSettings = block?.kind === 'table' ? tableSettings(block.settings) : defaultTableSettings()
  const [columns, setColumns] = useState<ColumnDraft[]>(start.columns.map(toDraft))
  const [groupBy, setGroupBy] = useState(start.groupBy ?? '')
  const [currency, setCurrency] = useState(start.currency ?? 'NOK')
  const saving = create.isPending || update.isPending

  const isTable = kind === 'table'
  const columnProblem = !isTable ? null
    : columns.length === 0 ? 'A table needs at least one column.'
    : columns.some(c => !c.label.trim()) ? 'Every column needs a name.'
    : columns.some(c => c.type === 'status' && cleanOptions(c.options.split(',')).length === 0) ? 'A choice column needs its choices, separated by commas.'
    : null

  function pickKind(k: BlockKind) {
    // The title follows the kind until the owner types one of their own.
    if (!title.trim() || (kind && title === DEFAULT_TITLE[kind])) setTitle(DEFAULT_TITLE[k])
    setKind(k)
  }

  function settingsToSave(): TableSettings {
    const kept = columns.filter(c => !c.fresh)
    const keyOf = new Map<string, string>()
    for (const c of columns) {
      if (!c.fresh) continue
      const used = [...kept, ...[...keyOf.values()].map(key => ({ key }))]
      keyOf.set(c.key, newColumnKey(used, c.label.trim()))
    }
    const cols: TableColumn[] = columns.map(c => {
      const base = { key: keyOf.get(c.key) ?? c.key, label: c.label.trim(), type: c.type }
      return c.type === 'status' ? { ...base, options: cleanOptions(c.options.split(',')) } : base
    })
    const group = keyOf.get(groupBy) ?? groupBy
    return {
      columns: cols,
      groupBy: cols.some(c => c.key === group) ? group : null,
      ...(cols.some(c => c.type === 'money') ? { currency } : {}),
    }
  }

  async function save() {
    if (!kind || !title.trim() || columnProblem || saving) return
    const settings = isTable ? { ...settingsToSave() } as unknown as Record<string, unknown> : {}
    try {
      if (block) await update.mutateAsync({ id: block.id, projectId, patch: { title: title.trim(), settings } })
      else await create.mutateAsync({ input: { project_id: projectId, kind, title: title.trim(), settings }, sortOrder: nextSortOrder(siblings) })
      onClose()
    } catch { /* the hook said what failed */ }
  }

  async function remove() {
    if (!block) return
    const n = (entriesQ.data ?? []).filter(e => e.block_id === block.id).length
    const result = await del.run([block.id], {
      title: `Delete ${block.title}?`,
      message: n ? `Its ${n} ${n === 1 ? 'entry goes' : 'entries go'} with it.` : undefined,
      done: `${block.title} deleted`,
    })
    if (result === 'deleted' || result === 'gone') onClose()
  }

  const setColumn = (i: number, patch: Partial<ColumnDraft>) => setColumns(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const moveColumn = (i: number, dir: -1 | 1) => setColumns(cs => {
    const j = i + dir
    if (j < 0 || j >= cs.length) return cs
    const next = [...cs]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const addColumn = () => setColumns(cs => [...cs, { key: newColumnKey(cs, `new ${cs.length + 1}`), label: '', type: 'text', options: '', fresh: true }])
  const groupable = columns.filter(c => (c.type === 'text' || c.type === 'status') && c.label.trim())

  return (
    <ModalShell
      onClose={onClose}
      title={block ? `Edit ${block.title}` : 'Add a block'}
      size={isTable ? 'lg' : 'sm'}
      dismissible={!saving}
      footer={
        <div className="flex items-center gap-2">
          {block && <IconButton label="Delete block" onClick={() => { void remove() }} className="hover:text-danger"><Trash2 /></IconButton>}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!kind || !title.trim() || !!columnProblem}>
            {block ? 'Save' : 'Add block'}
          </Button>
        </div>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void save() }}>
        {!block && (
          <fieldset>
            <legend className="field-label">Kind</legend>
            <div className="flex flex-col gap-1.5">
              {BLOCK_KINDS.map(k => {
                const Icon = BLOCK_ICON[k]
                const on = kind === k
                return (
                  <button key={k} type="button" aria-pressed={on} onClick={() => pickKind(k)}
                    className={cx('flex min-h-[44px] items-start gap-2.5 rounded-row border px-3 py-2 text-left transition-colors',
                      on ? 'border-accent-500 bg-accent-50' : 'border-line hover:bg-surface-hover')}>
                    <Icon aria-hidden className={cx('mt-0.5 h-4 w-4 shrink-0', on ? 'text-accent-600' : 'text-fg-muted')} />
                    <span className="min-w-0">
                      <span className="block text-ui text-fg">{BLOCK_KIND_LABEL[k]}</span>
                      <span className="block text-meta text-fg-muted">{BLOCK_KIND_HINT[k]}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}

        {kind && (
          <div>
            <label htmlFor="bl-title" className="field-label">Name</label>
            <input id="bl-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} className="input max-w-md" />
          </div>
        )}

        {isTable && (
          <fieldset className="flex flex-col gap-2">
            <legend className="field-label">Columns</legend>
            {columns.map((c, i) => (
              <div key={c.key} className="flex flex-col gap-1.5 rounded-row border border-line p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <input aria-label={`Column ${i + 1} name`} value={c.label} onChange={e => setColumn(i, { label: e.target.value })}
                    maxLength={40} placeholder="Name" className="input input-sm min-w-0 flex-1 basis-32" />
                  <select aria-label={`Column ${i + 1} kind`} value={c.type} onChange={e => setColumn(i, { type: e.target.value as ColumnType })}
                    className="select input-sm w-auto">
                    {COLUMN_TYPES.map(t => <option key={t} value={t}>{COLUMN_TYPE_LABEL[t]}</option>)}
                  </select>
                  <span className="flex items-center">
                    <IconButton label="Move up" disabled={i === 0} onClick={() => moveColumn(i, -1)}><ArrowUp /></IconButton>
                    <IconButton label="Move down" disabled={i === columns.length - 1} onClick={() => moveColumn(i, 1)}><ArrowDown /></IconButton>
                    <IconButton label={`Remove ${c.label || 'column'}`} onClick={() => setColumns(cs => cs.filter((_, j) => j !== i))}
                      className="hover:text-danger"><X /></IconButton>
                  </span>
                </div>
                {c.type === 'status' && (
                  <input aria-label={`${c.label || 'Column'} choices`} value={c.options} onChange={e => setColumn(i, { options: e.target.value })}
                    placeholder="Choices, separated by commas: In hand, To buy, Ordered" className="input input-sm" />
                )}
              </div>
            ))}
            <Button variant="ghost" size="sm" icon={<Plus />} onClick={addColumn} className="self-start">Column</Button>
            {block && (
              <p className="text-meta text-fg-muted">
                A removed column's values stay in the rows, unseen. A column changed to another kind hides values that don't fit it (text in a number column) — they come back if you change it back.
              </p>
            )}
            {columnProblem && <p className="text-meta text-danger">{columnProblem}</p>}
            <div className="grid grid-cols-1 gap-3 min-[26rem]:grid-cols-2">
              <div>
                <label htmlFor="bl-group" className="field-label">Group rows by</label>
                <select id="bl-group" value={groupBy} onChange={e => setGroupBy(e.target.value)} className="select">
                  <option value="">No grouping</option>
                  {groupable.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              {columns.some(c => c.type === 'money') && (
                <div>
                  <label htmlFor="bl-cur" className="field-label">Currency</label>
                  <select id="bl-cur" value={currency} onChange={e => setCurrency(e.target.value)} className="select">
                    {SHOP_CURRENCIES.map(cur => <option key={cur} value={cur}>{cur}</option>)}
                  </select>
                </div>
              )}
            </div>
          </fieldset>
        )}
      </form>
    </ModalShell>
  )
}
