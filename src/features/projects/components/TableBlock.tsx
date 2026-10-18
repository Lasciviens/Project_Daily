import { useState } from 'react'
import { Check } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, TonePill, Truncate, cx } from '../../../shared/ui'
import { formatMoney } from '../../settings/subscriptionRules'
import { useUpdateEntry } from '../hooks/useProjects'
import {
  cellText, groupRows, moneyTotals, orderEntries, rowTitle, statusColumn, statusCounts, tableSettings, titleColumn, type RowGroup,
} from '../projectModel'
import type { ProjectBlock, ProjectEntry, TableColumn, TableSettings } from '../types'

/**
 * A table block: rows with the block's own columns. A choice column splits it
 * ("In hand · To buy"); a group column heads its rows ("Boards", "Weighing").
 * Wide, it is a table; narrow (a phone, a side track), each row is its name
 * and its choice — the rest opens with the row.
 */
export function TableBlockBody({ block, rows, onAdd }: { block: ProjectBlock; rows: ProjectEntry[]; onAdd: () => void }) {
  const modal = useEntityModal()
  const settings = tableSettings(block.settings)
  const status = statusColumn(settings)
  const [filter, setFilter] = useState<string | null>(null)
  const ordered = orderEntries('table', rows)
  const shown = status && filter ? ordered.filter(r => r.data[status.key] === filter) : ordered
  const groups = groupRows(shown, settings)
  const totals = moneyTotals(shown, settings)
  const open = (row: ProjectEntry) => modal.open({ kind: 'project-entry', projectId: block.project_id, blockId: block.id, id: row.id })

  if (settings.columns.length === 0) {
    return <p className="text-meta text-fg-muted">This table has no columns yet. Add them from its ⋯ menu.</p>
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-meta text-fg-muted">No rows yet. Columns: {settings.columns.map(c => c.label).join(' · ')}.</p>
        <Button size="sm" onClick={onAdd}>Add a row</Button>
      </div>
    )
  }

  return (
    <div className="@container flex flex-col gap-2">
      {status && (
        <div role="group" aria-label={`Filter by ${status.label}`} className="scroll-x -mx-1 flex gap-1 px-1">
          <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)} className="pill-tab shrink-0">
            All <span className="count-badge">{rows.length}</span>
          </button>
          {statusCounts(rows, status).map(({ option, count }) => (
            <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(f => (f === option ? null : option))}
              className="pill-tab shrink-0">
              {option} <span className="count-badge">{count}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-2 text-meta text-fg-muted">No rows are “{filter}”.</p>
      ) : (
        <>
          <WideTable settings={settings} groups={groups} onOpen={open} />
          <NarrowRows settings={settings} status={status} groups={groups} onOpen={open} />
        </>
      )}

      {totals.length > 0 && (
        <p className="flex flex-wrap justify-end gap-x-4 border-t border-line pt-2 text-meta text-fg-muted">
          {totals.map(t => (
            <span key={t.column.key}>
              {t.column.label} total <span className="font-semibold tabular-nums text-fg">{formatMoney(t.total, settings.currency ?? 'NOK')}</span>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

type Groups = RowGroup<ProjectEntry>[]

/** The columns a table shows: all but the group column (its value heads the rows). */
const visibleColumns = (s: TableSettings) => s.columns.filter(c => c.key !== s.groupBy)

/** A tick box column is ticked in place (Packed, Paid) — no need to open the row. */
function CheckToggle({ row, column, title, labelled }: { row: ProjectEntry; column: TableColumn; title: string; labelled?: boolean }) {
  const update = useUpdateEntry()
  const on = row.data[column.key] === true
  function toggle() {
    const data = { ...row.data }
    if (on) delete data[column.key]
    else data[column.key] = true
    const word = column.label.toLowerCase()
    update.mutate({ id: row.id, fields: { data }, message: `${title}: ${on ? `not ${word}` : word}` })
  }
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={`${column.label}: ${title}`} onClick={toggle}
      className={cx('flex shrink-0 items-center gap-1.5 rounded-row text-meta text-fg-muted', labelled ? 'px-1.5 py-1' : 'icon-btn h-8 w-8')}>
      <span aria-hidden className={cx('grid h-[18px] w-[18px] place-items-center rounded-md border-2 transition-colors',
        on ? 'border-success bg-success text-white' : 'border-line-strong')}>
        {on && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {labelled && column.label}
    </button>
  )
}

function Cell({ column, value, currency }: { column: TableColumn; value: unknown; currency?: string }) {
  const text = cellText(column, value, currency)
  if (column.type === 'link' && typeof value === 'string' && text) {
    return <a href={value} target="_blank" rel="noreferrer noopener" onClick={e => e.stopPropagation()} className="text-accent-600 hover:underline"><Truncate>{text}</Truncate></a>
  }
  return <>{text}</>
}

function WideTable({ settings, groups, onOpen }: { settings: TableSettings; groups: Groups; onOpen: (r: ProjectEntry) => void }) {
  const cols = visibleColumns(settings)
  const title = titleColumn(settings)
  const right = (c: TableColumn) => c.type === 'number' || c.type === 'money'
  return (
    <div className="hidden overflow-x-auto @[32rem]:block">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} scope="col" className={cx('section-label border-b border-line px-2 py-1.5 font-semibold', right(c) ? 'text-right' : 'text-left')}>{c.label}</th>
            ))}
          </tr>
        </thead>
        {groups.map(g => (
          <tbody key={g.group ?? '∅'}>
            {settings.groupBy && (
              <tr><th colSpan={cols.length} scope="colgroup" className="section-label px-2 pb-1 pt-3 text-left">{g.group ?? 'No group'}</th></tr>
            )}
            {g.rows.map(r => (
              <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-surface-hover">
                {cols.map(c => (
                  <td key={c.key} className={cx('max-w-[18rem] px-2 py-1.5 align-top text-fg-2', right(c) && 'text-right tabular-nums')}>
                    {c.key === title?.key
                      ? <button type="button" onClick={() => onOpen(r)} className="text-left font-medium text-fg hover:underline">{rowTitle(settings, r.data)}</button>
                      : c.type === 'check'
                        ? <CheckToggle row={r} column={c} title={rowTitle(settings, r.data)} />
                        : <Cell column={c} value={r.data[c.key]} currency={settings.currency} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function NarrowRows({ settings, status, groups, onOpen }: {
  settings: TableSettings; status: TableColumn | null; groups: Groups; onOpen: (r: ProjectEntry) => void
}) {
  const checks = settings.columns.filter(c => c.type === 'check')
  return (
    <div className="flex flex-col gap-2 @[32rem]:hidden">
      {groups.map(g => (
        <div key={g.group ?? '∅'}>
          {settings.groupBy && <h4 className="section-label px-1.5 pb-1">{g.group ?? 'No group'}</h4>}
          <ul className="flex flex-col">
            {g.rows.map(r => {
              const state = status ? r.data[status.key] : null
              const name = rowTitle(settings, r.data)
              return (
                <li key={r.id} className="flex min-h-[40px] items-center gap-1 rounded-row hover:bg-surface-hover">
                  <button type="button" onClick={() => onOpen(r)} className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2 px-1.5 text-left">
                    <Truncate className="min-w-0 flex-1 text-body text-fg">{name}</Truncate>
                    {typeof state === 'string' && state && <TonePill tone="neutral" className="shrink-0">{state}</TonePill>}
                  </button>
                  {checks.map(c => <CheckToggle key={c.key} row={r} column={c} title={name} labelled />)}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
