import { useRef, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react'
import { ListOrdered } from 'lucide-react'
import { PAGE_CHOICES, PAGE_OPTIONS } from './devRequestMeta'
import { CATEGORIES, EFFORTS, PRIORITIES, type DraftFields } from '../devRequestRules'
import type { DevRequestCategory, DevRequestEffort, DevRequestPriority } from '../types'
import { continueNumberedList, insertNumberedItem, type TextEdit } from '../numberedList'
import { Button, cx } from '../../../shared/ui'

interface Props {
  fields: DraftFields
  onChange: (patch: Partial<DraftFields>) => void
  autoFocusTitle?: boolean
  titleRef?: Ref<HTMLInputElement>
  descriptionRef?: RefObject<HTMLTextAreaElement | null>
  /** Tailwind classes for the description box (height). */
  descriptionClassName?: string
  /** Controls shown right under the description (pick on page, quote). */
  descriptionTools?: ReactNode
}

/** The request's fields, as the floating composer edits them. */
export function RequestFields({ fields, onChange, autoFocusTitle, titleRef, descriptionRef, descriptionClassName, descriptionTools }: Props) {
  const ownRef = useRef<HTMLTextAreaElement | null>(null)
  const areaRef = descriptionRef ?? ownRef

  // Writes an edit and puts the caret where it belongs once React re-rendered.
  function applyEdit(edit: TextEdit) {
    onChange({ description: edit.text })
    requestAnimationFrame(() => {
      const el = areaRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(edit.caret, edit.caret)
    })
  }
  function onDescriptionKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return
    const el = e.currentTarget
    if (el.selectionStart !== el.selectionEnd) return
    const edit = continueNumberedList(el.value, el.selectionStart)
    if (!edit) return
    e.preventDefault()
    applyEdit(edit)
  }
  const addNumbered = () => {
    const el = areaRef.current
    applyEdit(insertNumberedItem(fields.description, el ? el.selectionStart : fields.description.length))
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
      <textarea
        ref={areaRef}
        value={fields.description}
        onChange={e => onChange({ description: e.target.value })}
        onKeyDown={onDescriptionKeyDown}
        placeholder="Details (optional) — the more context, the less back-and-forth later"
        aria-label="Details"
        rows={4}
        className={cx('input resize-y', descriptionClassName ?? 'min-h-[90px] md:min-h-[160px]')}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={<ListOrdered />}
          // Keep the caret where it is: mousedown would move focus off the text box.
          onMouseDown={e => e.preventDefault()}
          onClick={addNumbered}
          title="Start a numbered point (1- …). Enter continues the list, Enter on an empty point ends it."
        >
          Numbered list
        </Button>
        {descriptionTools}
      </div>
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
