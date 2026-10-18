import { useState, type ReactNode } from 'react'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { ChevronDown, ChevronRight, ExternalLink, Pencil } from 'lucide-react'
import { HoverPeek } from '../../../shared/components/HoverPeek'
import { useEntityModal } from '../../../shared/modals'
import { Button, IconButton, TonePill, Truncate, cx } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { linkLabel, orderEntries } from '../projectModel'
import { firstLine } from '../proseModel'
import { ProseText } from './ProseText'
import { DOTTED } from './peekStyle'
import type { ProjectBlock, ProjectEntry } from '../types'

const SHOWN = 5

type BodyProps = { block: ProjectBlock; entries: ProjectEntry[]; onAdd: () => void }

function useOpenEntry(block: ProjectBlock) {
  const modal = useEntityModal()
  return (entry: ProjectEntry) => modal.open({ kind: 'project-entry', projectId: block.project_id, blockId: block.id, id: entry.id })
}

function Empty({ text, action, onAdd }: { text: string; action: string; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-meta text-fg-muted">{text}</p>
      <Button size="sm" onClick={onAdd}>{action}</Button>
    </div>
  )
}

/** "Show all 12" / "Show fewer" under a long list. */
function MoreToggle({ total, all, onToggle }: { total: number; all: boolean; onToggle: () => void }) {
  if (total <= SHOWN) return null
  return (
    <button type="button" onClick={onToggle} className="self-start px-1.5 text-meta font-semibold text-accent-600">
      {all ? 'Show fewer' : `Show all ${total}`}
    </button>
  )
}

/** One entry that opens in place: its title; open, its date, its text and Edit. */
function OpenableEntry({ entry, title, meta, tone, onEdit, children }: {
  entry: ProjectEntry; title: string; meta?: string | null; tone?: 'warn'; onEdit: () => void; children?: ReactNode
}) {
  return (
    <Disclosure as="li" className={cx('rounded-row', tone === 'warn' && 'bg-warn-soft')}>
      {({ open }) => (
        <>
          <DisclosureButton className="flex min-h-[40px] w-full items-center gap-2 px-1.5 text-left">
            <ChevronRight aria-hidden className={cx('h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
            <Truncate className={cx('min-w-0 flex-1 text-body', tone === 'warn' ? 'font-semibold text-fg' : 'text-fg')}>{title}</Truncate>
            {children}
          </DisclosureButton>
          <DisclosurePanel className="flex flex-col gap-1.5 pb-2 pl-7 pr-1.5">
            {meta && <p className="text-meta text-fg-muted">{meta}</p>}
            {entry.body ? <ProseText text={entry.body} /> : null}
            <button type="button" onClick={onEdit} className="flex items-center gap-1 self-start text-meta font-semibold text-accent-600">
              <Pencil aria-hidden className="h-3.5 w-3.5" /> Edit
            </button>
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  )
}

/** A log: newest first, each entry's day and text behind a tap. */
export function LogBody({ block, entries, onAdd }: BodyProps) {
  const openEntry = useOpenEntry(block)
  const [all, setAll] = useState(false)
  const ordered = orderEntries('log', entries)
  if (ordered.length === 0) return <Empty text="Dated notes on what was done, measured or learned." action="Add a log entry" onAdd={onAdd} />
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col">
        {(all ? ordered : ordered.slice(0, SHOWN)).map(e => (
          <OpenableEntry key={e.id} entry={e} title={e.title || firstLine(e.body) || 'Log entry'}
            meta={e.entry_date ? formatDate(e.entry_date) : null} onEdit={() => openEntry(e)} />
        ))}
      </ul>
      <MoreToggle total={ordered.length} all={all} onToggle={() => setAll(a => !a)} />
    </div>
  )
}

/** Questions first (they stand out); decisions after, newest first — the reasons behind a tap. */
export function DecisionsBody({ block, entries, onAdd }: BodyProps) {
  const openEntry = useOpenEntry(block)
  const [all, setAll] = useState(false)
  const ordered = orderEntries('decisions', entries)
  const questions = ordered.filter(e => e.state !== 'decided')
  const decisions = ordered.filter(e => e.state === 'decided')
  if (ordered.length === 0) return <Empty text="Open questions, and what you decided and why." action="Add a question" onAdd={onAdd} />
  return (
    <div className="flex flex-col gap-2">
      {questions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {questions.map(e => (
            <OpenableEntry key={e.id} entry={e} title={e.title || 'Question'} tone="warn" onEdit={() => openEntry(e)}>
              <TonePill tone="warn" className="shrink-0">Open</TonePill>
            </OpenableEntry>
          ))}
        </ul>
      )}
      {decisions.length > 0 && (
        <ul className="flex flex-col">
          {(all ? decisions : decisions.slice(0, SHOWN)).map(e => (
            <OpenableEntry key={e.id} entry={e} title={e.title || 'Decision'}
              meta={e.entry_date ? `Decided ${formatDate(e.entry_date)}` : null} onEdit={() => openEntry(e)} />
          ))}
        </ul>
      )}
      <MoreToggle total={decisions.length} all={all} onToggle={() => setAll(a => !a)} />
    </div>
  )
}

/** Text pages: their titles; a page opens to read. */
export function PagesBody({ block, entries, onAdd }: BodyProps) {
  const openEntry = useOpenEntry(block)
  const ordered = orderEntries('pages', entries)
  if (ordered.length === 0) return <Empty text="Guides and notes: headings, lists, steps and code." action="Add a page" onAdd={onAdd} />
  return (
    <ul className="@container grid grid-cols-1 gap-1.5 @[34rem]:grid-cols-2 @[52rem]:grid-cols-3">
      {ordered.map(e => (
        <li key={e.id}>
          <button type="button" onClick={() => openEntry(e)}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-row border border-line px-3 py-2 text-left transition-colors hover:bg-surface-hover">
            <Truncate className="min-w-0 flex-1 text-body font-medium text-fg">{e.title || 'Untitled page'}</Truncate>
            <ChevronDown aria-hidden className="h-4 w-4 shrink-0 -rotate-90 text-fg-faint" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Links: each opens its page; its site's name beside it opens the note and the full address (hover or tap). */
export function LinksBody({ block, entries, onAdd }: BodyProps) {
  const openEntry = useOpenEntry(block)
  const ordered = orderEntries('links', entries)
  if (ordered.length === 0) return <Empty text="Sources, documents, shops and photo albums." action="Add a link" onAdd={onAdd} />
  return (
    <ul className="flex flex-col">
      {ordered.map(e => (
        <li key={e.id} className="group/row flex min-h-[40px] items-center gap-2 rounded-row px-1.5 hover:bg-surface-hover">
          <ExternalLink aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
          <a href={e.url ?? undefined} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 text-body font-medium text-accent-600 hover:underline">
            <Truncate>{e.title || (e.url ? linkLabel(e.url) : 'Link')}</Truncate>
          </a>
          {(e.body || e.url) && (
            <HoverPeek trigger={<span className={cx(DOTTED, 'text-meta text-fg-muted')}>{e.url ? linkLabel(e.url).split('/')[0] : 'Note'}</span>}
              label={`About ${e.title || 'this link'}`} className="shrink-0" panelClassName="w-72">
              {e.body && <p className="mb-1 whitespace-pre-line text-body text-fg-2">{e.body}</p>}
              {e.url && <p className="break-all text-meta text-fg-muted">{e.url}</p>}
            </HoverPeek>
          )}
          <IconButton label={`Edit ${e.title || 'link'}`} onClick={() => openEntry(e)}
            className="h-8 w-8 shrink-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100">
            <Pencil />
          </IconButton>
        </li>
      ))}
    </ul>
  )
}
