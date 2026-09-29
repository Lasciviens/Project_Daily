import { useCallback, useMemo, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { ListChecks } from 'lucide-react'
import { PAGE_CHOICES, PAGE_OPTIONS } from './devRequestMeta'
import { CATEGORIES, EFFORTS, PRIORITIES, type DraftFields } from '../devRequestRules'
import type { DevRequestCategory, DevRequestEffort, DevRequestPriority } from '../types'
import { composeDescription, parseDescription, pickLabel, unlinkedPicks, type PickMark } from '../devRequestMarks'
import { insertAfter, removeAt, setDone, setText, type Checkpoint } from '../checkpoints'
import { CheckpointList } from './CheckpointList'
import { MarkList } from './MarkList'
import { LinkedTextEditor } from './LinkedTextEditor'
import { useGoToMark } from '../pick/goToMark'
import { Button, cx } from '../../../shared/ui'

interface Props {
  fields: DraftFields
  onChange: (patch: Partial<DraftFields>) => void
  /**
   * A tick on a checkpoint, when the caller writes it somewhere itself (an
   * existing request: saved at once). Without it a tick is a draft change.
   */
  onToggleCheckpoint?: (index: number, done: boolean, items: readonly Checkpoint[]) => void
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
 * Water card to be red" — a click opens the spot); checkpoints show as
 * checkboxes, and picks from before links as rows under it (all stored in
 * `description`, see devRequestMarks.ts).
 */
export function RequestFields({ fields, onChange, onToggleCheckpoint, autoFocusTitle, titleRef, descriptionRef, descriptionClassName, descriptionTools }: Props) {
  const parsed = useMemo(() => parseDescription(fields.description), [fields.description])
  const goTo = useGoToMark()
  const linked = useMemo(() => new Map(parsed.marks.flatMap(m => (m.type === 'pick' && m.id ? [[m.id, m] as const] : []))), [parsed.marks])
  const labelOf = useCallback((id: string) => { const m = linked.get(id); return m ? pickLabel(m) : 'missing link' }, [linked])
  const openLink = (id: string) => { const m: PickMark | undefined = linked.get(id); if (m) goTo(m) }
  const rows = unlinkedPicks(parsed.marks)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const onFocused = useCallback(() => setFocusIndex(null), [])
  const write = (patch: Partial<typeof parsed>) => onChange({ description: composeDescription({ ...parsed, ...patch }) })
  const setCheckpoints = (checkpoints: Checkpoint[]) => write({ checkpoints })
  const addAfter = (index: number) => {
    const next = insertAfter(parsed.checkpoints, index)
    setCheckpoints(next.items)
    setFocusIndex(next.at)
  }
  const toggle = (i: number, done: boolean) => {
    if (onToggleCheckpoint) onToggleCheckpoint(i, done, parsed.checkpoints)
    else setCheckpoints(setDone(parsed.checkpoints, i, done))
  }

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
        value={parsed.body}
        onChange={body => write({ body })}
        labelOf={labelOf}
        onOpenLink={openLink}
        placeholder="Details (optional) — Pick on page puts a link to that spot where you're typing"
        ariaLabel="Details"
        className={cx('max-h-[50vh]', descriptionClassName ?? 'min-h-[90px] md:min-h-[160px]')}
      />
      <CheckpointList
        items={parsed.checkpoints}
        onToggle={toggle}
        edit={{
          onText: (i, text) => setCheckpoints(setText(parsed.checkpoints, i, text)),
          onRemove: i => setCheckpoints(removeAt(parsed.checkpoints, i)),
          onAddAfter: addAfter,
          focusIndex,
          onFocused,
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={<ListChecks />}
          onClick={() => addAfter(parsed.checkpoints.length - 1)}
          title="Add a point you can tick off once it is done. Enter in a checkpoint adds the next one."
        >
          Add checkpoint
        </Button>
        {descriptionTools}
      </div>
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
