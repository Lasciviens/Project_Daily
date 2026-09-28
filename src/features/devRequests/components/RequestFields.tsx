import type { ReactNode, Ref } from 'react'
import { PAGE_CHOICES, PAGE_OPTIONS } from './devRequestMeta'
import { CATEGORIES, EFFORTS, PRIORITIES, type DraftFields } from '../devRequestRules'
import type { DevRequestCategory, DevRequestEffort, DevRequestPriority } from '../types'
import { cx } from '../../../shared/ui'

interface Props {
  fields: DraftFields
  onChange: (patch: Partial<DraftFields>) => void
  autoFocusTitle?: boolean
  descriptionRef?: Ref<HTMLTextAreaElement>
  /** Tailwind classes for the description box (height). */
  descriptionClassName?: string
  /** Controls shown right under the description (pick on page, quote). */
  descriptionTools?: ReactNode
}

/** The request's fields — one editor for the drawer's inline form and the floating composer. */
export function RequestFields({ fields, onChange, autoFocusTitle, descriptionRef, descriptionClassName, descriptionTools }: Props) {
  // A page value from before the dropdown (free text) stays selectable, so
  // saving an old request never silently rewrites it to "other".
  const legacyPage = fields.page && fields.page !== 'other' && !PAGE_OPTIONS.includes(fields.page) ? fields.page : null
  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus={autoFocusTitle}
        value={fields.title}
        onChange={e => onChange({ title: e.target.value })}
        placeholder="What's the request, bug or idea?"
        aria-label="Title"
        className="input"
      />
      <textarea
        ref={descriptionRef}
        value={fields.description}
        onChange={e => onChange({ description: e.target.value })}
        placeholder="Details (optional) — the more context, the less back-and-forth later"
        aria-label="Details"
        rows={4}
        className={cx('input resize-y', descriptionClassName ?? 'min-h-[90px] md:min-h-[160px]')}
      />
      {descriptionTools}
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
