import { useCallback, useMemo, useState, type ReactNode, type Ref } from 'react'
import { ChevronDown, IndentDecrease, IndentIncrease } from 'lucide-react'
import { PAGE_CHOICES, PAGE_OPTIONS, STATUSES, STATUS_LABEL } from './devRequestMeta'
import { CATEGORIES, EFFORTS, PRIORITIES, type DraftFields } from '../devRequestRules'
import type { DevRequestCategory, DevRequestEffort, DevRequestPriority, DevRequestStatus } from '../types'
import { composeDescription, foldCheckpoints, parseDescription, pickLabel, unlinkedPicks, type PickMark } from '../devRequestMarks'
import { MarkList } from './MarkList'
import { OutlineEditor, type OutlineHandle, type OutlineReview } from './OutlineEditor'
import { useGoToMark } from '../pick/goToMark'
import { IconButton, Truncate, cx } from '../../../shared/ui'

interface Props {
  fields: DraftFields
  onChange: (patch: Partial<DraftFields>) => void
  /** Fixed / Not fixed per point: a saved request that went to Claude (written at once). */
  review?: Omit<OutlineReview, 'lookup'>
  /** A saved request's status (applies at once, not part of the draft). */
  status?: { value: DevRequestStatus; onChange: (s: DevRequestStatus) => void; disabled?: boolean }
  titleRef?: Ref<HTMLInputElement>
  outlineRef?: Ref<OutlineHandle>
  /** The editor glows briefly (a pick was just put in). */
  flash?: boolean
  /** Shown between the details and the editor (the review bar). */
  beforeEditor?: ReactNode
  /** Pick on page / Quote selection, shown under the editor. */
  tools?: ReactNode
  /** Keyboard hints (a mouse and keyboard). */
  showKeys?: boolean
}

const META = 'select !min-h-[32px] h-8 w-auto max-w-[13rem] rounded-full py-0 pl-3 text-meta [@media(pointer:coarse)]:!min-h-[44px] [@media(pointer:coarse)]:h-11'

/**
 * The request as the request window edits it: a title, the outline editor — the points, numbered as
 * you write them (outline.ts), with links to picked spots in them ("Water
 * card" — a click opens the spot), then its details as one row of compact
 * selects. Picks from before links show as rows.
 * Everything is stored in `description` (devRequestMarks.ts / points.ts).
 */
export function RequestFields({ fields, onChange, review, status, titleRef, outlineRef, flash, beforeEditor, tools, showKeys }: Props) {
  const parsed = useMemo(() => parseDescription(fields.description), [fields.description])
  const goTo = useGoToMark()
  const linked = useMemo(() => new Map(parsed.marks.flatMap(m => (m.type === 'pick' && m.id ? [[m.id, m] as const] : []))), [parsed.marks])
  const labelOf = useCallback((id: string) => { const m = linked.get(id); return m ? pickLabel(m) : 'missing link' }, [linked])
  const openLink = useCallback((id: string) => { const m: PickMark | undefined = linked.get(id); if (m) goTo(m) }, [linked, goTo])
  const rows = unlinkedPicks(parsed.marks)
  // Older "- [ ]" checkpoints show (and are edited) as points of the outline; a tick is a Fixed review.
  const folded = useMemo(() => foldCheckpoints(parsed), [parsed])
  const write = (patch: Partial<typeof folded>) => onChange({ description: composeDescription({ ...folded, ...patch }) })
  const outlineReview = useMemo<OutlineReview | undefined>(
    () => (review ? { ...review, lookup: (key: string) => folded.reviews.find(r => r.key === key) ?? null } : undefined),
    [review, folded.reviews],
  )

  // A page value from before the dropdown (free text) stays selectable, so
  // saving an old request never silently rewrites it to "other".
  const legacyPage = fields.page && fields.page !== 'other' && !PAGE_OPTIONS.includes(fields.page) ? fields.page : null
  const pageLabel = PAGE_CHOICES.find(p => p.value === fields.page)?.value ?? (fields.page === 'other' ? 'other page' : fields.page)
  const summary = [status ? STATUS_LABEL[status.value] : null, fields.category, `${fields.priority} priority`, pageLabel, fields.effort ? `${fields.effort} effort` : null].filter(Boolean).join(' · ')
  const indent = (d: 1 | -1) => { const h = outlineRef && typeof outlineRef === 'object' ? outlineRef.current : null; h?.indent(d) }
  return (
    <div className="flex flex-col gap-3">
      <input
        ref={titleRef}
        value={fields.title}
        onChange={e => onChange({ title: e.target.value })}
        placeholder="Title — what's the request, bug or idea?"
        aria-label="Title"
        className="-mx-1 min-h-[44px] rounded-control bg-transparent px-1 text-lead font-semibold text-fg outline-none placeholder:font-medium placeholder:text-fg-faint focus-visible:bg-surface-2"
      />
      {beforeEditor}
      <div className="flex flex-col gap-1.5">
        <OutlineEditor
          handleRef={outlineRef}
          value={folded.body}
          onChange={body => write({ body })}
          labelOf={labelOf}
          onOpenLink={openLink}
          review={outlineReview}
          flash={flash}
          placeholder="Describe it. Enter starts the next point, Tab makes a sub-point."
          ariaLabel="Points"
          className="min-h-[9rem]"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {tools}
          <span className="ml-auto flex items-center gap-0.5">
            {showKeys && <span className="mr-1 hidden text-meta text-fg-faint sm:inline"><span className="kbd">Tab</span> sub-point · <span className="kbd">⇧</span><span className="kbd">↵</span> new line</span>}
            <IconButton label="Make it a point again (Shift+Tab)" onMouseDown={e => e.preventDefault()} onClick={() => indent(-1)} className={TOOL}><IndentDecrease /></IconButton>
            <IconButton label="Make it a sub-point (Tab)" onMouseDown={e => e.preventDefault()} onClick={() => indent(1)} className={TOOL}><IndentIncrease /></IconButton>
          </span>
        </div>
      </div>
      <DetailsRow summary={summary}>
        <div className="flex flex-wrap items-center gap-1.5">
          {status && (
            <select value={status.value} onChange={e => status.onChange(e.target.value as DevRequestStatus)} disabled={status.disabled} aria-label="Status" className={META}>
              {STATUSES.map(st => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
            </select>
          )}
          <select value={fields.category} onChange={e => onChange({ category: e.target.value as DevRequestCategory })} aria-label="Category" className={META}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={fields.priority} onChange={e => onChange({ priority: e.target.value as DevRequestPriority })} aria-label="Priority" className={META}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p} priority</option>)}
          </select>
          <select value={fields.page} onChange={e => onChange({ page: e.target.value })} aria-label="Page" className={META}>
            {PAGE_CHOICES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            {legacyPage && <option value={legacyPage}>{legacyPage}</option>}
            <option value="other">Other page</option>
          </select>
          <select value={fields.effort} onChange={e => onChange({ effort: e.target.value as DevRequestEffort | '' })} aria-label="Effort" className={META}>
            <option value="">Effort?</option>
            {EFFORTS.map(f => <option key={f} value={f}>{f} effort</option>)}
          </select>
        </div>
      </DetailsRow>
      <MarkList marks={rows} onRemove={i => write({ marks: parsed.marks.filter(m => m !== rows[i]) })} />
    </div>
  )
}

const TOOL = cx('!h-9 !w-9 text-fg-muted [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11')

/**
 * The request's details (status, category, priority, page, effort) as one
 * row of compact selects under the points. On a phone they fold into one
 * summary line, so the points stay the first thing on screen.
 */
function DetailsRow({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-label="Details" className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] items-center gap-2 rounded-row border border-line bg-surface-2 px-3 text-left sm:hidden"
      >
        <span className="section-label shrink-0">Details</span>
        <Truncate reveal="none" className="min-w-0 flex-1 text-meta text-fg-2">{summary}</Truncate>
        <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-muted transition-transform', open && 'rotate-180')} />
      </button>
      <div className={cx(open ? 'block' : 'hidden', 'sm:block')}>{children}</div>
    </section>
  )
}
