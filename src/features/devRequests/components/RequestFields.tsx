import { useCallback, useMemo, type ReactNode, type Ref, type RefObject } from 'react'
import { PAGE_CHOICES, PAGE_OPTIONS } from './devRequestMeta'
import { CATEGORIES, EFFORTS, PRIORITIES, type DraftFields } from '../devRequestRules'
import type { DevRequestCategory, DevRequestEffort, DevRequestPriority } from '../types'
import { composeDescription, foldCheckpoints, parseDescription, pickLabel, unlinkedPicks, type PickMark } from '../devRequestMarks'
import { requestPoints } from '../points'
import { PointList, type PointReviewActions } from './PointList'
import { MarkList } from './MarkList'
import { LinkedTextEditor } from './LinkedTextEditor'
import { useGoToMark } from '../pick/goToMark'
import { cx } from '../../../shared/ui'

interface Props {
  fields: DraftFields
  onChange: (patch: Partial<DraftFields>) => void
  /** Fixed / Not fixed per point: a saved request that went to Claude (written at once). */
  review?: PointReviewActions
  autoFocusTitle?: boolean
  titleRef?: Ref<HTMLInputElement>
  descriptionRef?: RefObject<HTMLDivElement | null>
  /** Tailwind classes for the description box (height). */
  descriptionClassName?: string
  /** Controls shown right under the description (pick on page, quote). */
  descriptionTools?: ReactNode
}

/**
 * The request's fields, as the floating composer edits them. The text box
 * holds the user's own words with links to picked spots in them ("I want
 * Water card to be red" — a click opens the spot). Every paragraph is a
 * point: one Enter is a line break, an empty line starts the next point; the
 * numbered list under the box shows how the text is split (and, once the
 * request went to Claude, reviews each point). Picks from before links show
 * as rows (all stored in `description`, see devRequestMarks.ts / points.ts).
 */
export function RequestFields({ fields, onChange, review, autoFocusTitle, titleRef, descriptionRef, descriptionClassName, descriptionTools }: Props) {
  const parsed = useMemo(() => parseDescription(fields.description), [fields.description])
  const goTo = useGoToMark()
  const linked = useMemo(() => new Map(parsed.marks.flatMap(m => (m.type === 'pick' && m.id ? [[m.id, m] as const] : []))), [parsed.marks])
  const labelOf = useCallback((id: string) => { const m = linked.get(id); return m ? pickLabel(m) : 'missing link' }, [linked])
  const openLink = (id: string) => { const m: PickMark | undefined = linked.get(id); if (m) goTo(m) }
  const rows = unlinkedPicks(parsed.marks)
  // Older "- [ ]" checkpoints show (and are edited) as paragraphs of the text.
  const folded = useMemo(() => foldCheckpoints(parsed), [parsed])
  const points = useMemo(() => requestPoints(parsed), [parsed])
  const write = (patch: Partial<typeof folded>) => onChange({ description: composeDescription({ ...folded, ...patch }) })

  // A page value from before the dropdown (free text) stays selectable, so
  // saving an old request never silently rewrites it to "other".
  const legacyPage = fields.page && fields.page !== 'other' && !PAGE_OPTIONS.includes(fields.page) ? fields.page : null
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={titleRef}
        autoFocus={autoFocusTitle}
        value={fields.title}
        onChange={e => onChange({ title: e.target.value })}
        placeholder="What's the request, bug or idea?"
        aria-label="Title"
        className="input"
      />
      <LinkedTextEditor
        editorRef={descriptionRef}
        value={folded.body}
        onChange={body => write({ body })}
        labelOf={labelOf}
        onOpenLink={openLink}
        placeholder="Details — an empty line starts a new point. Pick on page puts a link to that spot where you're typing"
        ariaLabel="Details"
        className={cx('max-h-[50vh]', descriptionClassName ?? 'min-h-[90px] md:min-h-[160px]')}
      />
      <div className="flex flex-wrap items-center gap-1.5">{descriptionTools}</div>
      {(points.length > 1 || (review && points.length > 0)) && (
        <PointList points={points} marks={parsed.marks} review={review} lines={review ? 3 : 1} />
      )}
      {points.length === 1 && !review && <p className="text-meta text-fg-faint">One point so far — an empty line starts the next one.</p>}
      <MarkList marks={rows} onRemove={i => write({ marks: parsed.marks.filter(m => m !== rows[i]) })} />
      <div className="grid grid-cols-2 gap-2">
        <select value={fields.category} onChange={e => onChange({ category: e.target.value as DevRequestCategory })} aria-label="Category" className="select">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fields.priority} onChange={e => onChange({ priority: e.target.value as DevRequestPriority })} aria-label="Priority" className="select">
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={fields.page} onChange={e => onChange({ page: e.target.value })} aria-label="Page" className="select">
          {PAGE_CHOICES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          {legacyPage && <option value={legacyPage}>{legacyPage}</option>}
          <option value="other">other</option>
        </select>
        <select value={fields.effort} onChange={e => onChange({ effort: e.target.value as DevRequestEffort | '' })} aria-label="Effort" className="select">
          <option value="">effort?</option>
          {EFFORTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
    </div>
  )
}
