import { useCallback, useMemo, type ReactNode, type Ref } from 'react'
import { CircleDot, FileText, Flag, Gauge, IndentDecrease, IndentIncrease, Tag } from 'lucide-react'
import { CATEGORY_TONE, PAGE_CHOICES, PAGE_OPTIONS, PRIORITY_TONE, STATUSES, STATUS_LABEL, STATUS_TONE } from './devRequestMeta'
import { CATEGORIES, EFFORTS, PRIORITIES, type DraftFields } from '../devRequestRules'
import type { DevRequestCategory, DevRequestEffort, DevRequestPriority, DevRequestStatus } from '../types'
import { composeDescription, foldCheckpoints, parseDescription, pickLabel, unlinkedPicks, type PickMark } from '../devRequestMarks'
import { MarkList } from './MarkList'
import { OutlineEditor, type OutlineHandle, type OutlineReview } from './OutlineEditor'
import { PropertyPills, type Property } from './PropertyPills'
import { useGoToMark } from '../pick/goToMark'
import { IconButton, cx } from '../../../shared/ui'

interface Props {
  fields: DraftFields
  onChange: (patch: Partial<DraftFields>) => void
  /** Fixed / Not fixed per point: a saved request that went to Claude (written at once). */
  review?: Omit<OutlineReview, 'lookup'>
  /** A saved request's re-check note was edited (written at once); without it the note is part of the draft. */
  onTailNote?: (key: string, note: string) => void
  /** A saved request's status (applies at once, not part of the draft). */
  status?: { value: DevRequestStatus; onChange: (s: DevRequestStatus) => void; disabled?: boolean }
  titleRef?: Ref<HTMLInputElement>
  outlineRef?: Ref<OutlineHandle>
  /** The editor glows briefly (a pick was just put in). */
  flash?: boolean
  /** Shown between the title and the editor (dates, the review bar). */
  beforeEditor?: ReactNode
  /** Pick on page / Quote selection: the left end of the editor's toolbar. */
  tools?: ReactNode
  /** Keyboard hints (a mouse and keyboard). */
  showKeys?: boolean
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The request as the request window edits it: a title, the outline editor —
 * the points, numbered as you write them (outline.ts), with links to picked
 * spots in them ("Water card" — a click opens the spot) and its toolbar
 * (Pick on page, indent) — then the details as pill buttons, each a dropdown,
 * on every screen (14.10.2026: the phone's "Details" fold is gone — one tap
 * less to change a property). Picks from before links show as rows.
 * Everything is stored in `description` (devRequestMarks.ts).
 */
export function RequestFields({ fields, onChange, review, onTailNote, status, titleRef, outlineRef, flash, beforeEditor, tools, showKeys }: Props) {
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

  // A page value from before the list (free text) stays selectable, so
  // saving an old request never silently rewrites it to "other".
  const legacyPage = fields.page && fields.page !== 'other' && !PAGE_OPTIONS.includes(fields.page) ? fields.page : null
  const pages = [
    ...PAGE_CHOICES.map(p => ({ value: p.value, label: p.label })),
    ...(legacyPage ? [{ value: legacyPage, label: legacyPage }] : []),
    { value: 'other', label: 'Other page' },
  ]
  const props: Property[] = [
    ...(status ? [{
      id: 'status', name: 'Status', icon: <CircleDot aria-hidden />, value: status.value, disabled: status.disabled,
      options: STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s], tone: STATUS_TONE[s] })),
      onChange: (v: string) => status.onChange(v as DevRequestStatus),
    }] : []),
    {
      id: 'category', name: 'Category', icon: <Tag aria-hidden />, value: fields.category,
      options: CATEGORIES.map(c => ({ value: c, label: cap(c), tone: CATEGORY_TONE[c] })),
      onChange: v => onChange({ category: v as DevRequestCategory }),
    },
    {
      id: 'priority', name: 'Priority', icon: <Flag aria-hidden />, value: fields.priority,
      options: PRIORITIES.map(p => ({ value: p, label: cap(p), tone: PRIORITY_TONE[p] })),
      onChange: v => onChange({ priority: v as DevRequestPriority }),
    },
    {
      id: 'page', name: 'Page', icon: <FileText aria-hidden />, value: fields.page,
      options: pages,
      onChange: v => onChange({ page: v }),
    },
    {
      id: 'effort', name: 'Effort', icon: <Gauge aria-hidden />, value: fields.effort,
      options: [{ value: '', label: 'Effort?' }, ...EFFORTS.map(f => ({ value: f, label: `${cap(f)} effort` }))],
      onChange: v => onChange({ effort: v as DevRequestEffort | '' }),
    },
  ]
  const indent = (d: 1 | -1) => { const h = outlineRef && typeof outlineRef === 'object' ? outlineRef.current : null; h?.indent(d) }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <input
        ref={titleRef}
        value={fields.title}
        onChange={e => onChange({ title: e.target.value })}
        placeholder="Give it a title"
        aria-label="Title"
        className="-mx-2 min-h-[44px] rounded-control border border-transparent bg-transparent px-2 text-title font-semibold text-fg outline-none transition-colors placeholder:text-fg-faint [@media(hover:hover)]:hover:bg-surface-2 focus-visible:border-line focus-visible:bg-surface-2"
      />
      {beforeEditor}
      <OutlineEditor
        handleRef={outlineRef}
        value={folded.body}
        onChange={body => write({ body })}
        labelOf={labelOf}
        onOpenLink={openLink}
        review={outlineReview}
        onTailNote={onTailNote}
        flash={flash}
        placeholder="What should change? Enter starts the next point, Tab makes a sub-point."
        ariaLabel="Points"
        className="flex-1"
        footer={
          <>
            {tools}
            <span className="ml-auto flex items-center gap-0.5">
              {showKeys && (
                <span className="mr-1.5 hidden items-center gap-1 text-meta text-fg-faint sm:flex">
                  <span className="kbd">Tab</span>sub-point<span className="mx-0.5">·</span><span className="kbd">⇧↵</span>new line
                </span>
              )}
              <IconButton label="Make it a point again (Shift+Tab)" onMouseDown={e => e.preventDefault()} onClick={() => indent(-1)} className={TOOL}><IndentDecrease /></IconButton>
              <IconButton label="Make it a sub-point (Tab)" onMouseDown={e => e.preventDefault()} onClick={() => indent(1)} className={TOOL}><IndentIncrease /></IconButton>
            </span>
          </>
        }
      />
      <PropertyPills items={props} />
      <MarkList marks={rows} onRemove={i => write({ marks: parsed.marks.filter(m => m !== rows[i]) })} />
    </div>
  )
}

const TOOL = cx('!h-9 !w-9 text-fg-muted [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11')
