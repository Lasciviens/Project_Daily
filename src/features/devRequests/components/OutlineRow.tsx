import { memo, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowUpRight, Check, X } from 'lucide-react'
import type { PointReview } from '../devRequestMarks'
import { tailNote, type PointLevel } from '../outline'
import { REF_ATTR, focusAtOffset, lastCaret, render, selectionOffsets, serialize } from './linkedTextDom'
import { cx } from '../../../shared/ui'

// One point of the request editor: its number, its words (a small
// contenteditable that holds text and pick links — linkedTextDom maps it to
// `[[@id]]` tokens), and, once the request went to Claude, its review.
// Keys that cross points (Enter, Backspace at the start, Tab, arrows at an
// edge, paste) go to the editor as commands; typing inside a point is the
// browser's own.

export type RowCommand = 'enter' | 'backspace-start' | 'delete-end' | 'indent' | 'outdent' | 'up' | 'down' | 'left' | 'right'

export interface RowReview {
  review: PointReview | null
  onSet: (review: Omit<PointReview, 'key'> | null) => void
  onOpenRequest: (id: string) => void
}

interface Props {
  id: number
  level: PointLevel
  label: string
  text: string
  tail: string | null
  placeholder?: string
  /** Show the placeholder without focus (the only, empty point). */
  alwaysPlaceholder?: boolean
  labelOf: (id: string) => string
  labelKey: string
  ariaLabel: string
  review?: RowReview
  onText: (id: number, text: string, caret: number) => void
  onCommand: (id: number, cmd: RowCommand, sel: [number, number]) => void
  onPaste: (id: number, text: string, sel: [number, number]) => void
  onFocusRow: (id: number) => void
  onOpenLink: (refId: string) => void
  register: (id: number, el: HTMLDivElement | null) => void
}

const STATE_TONE = { fixed: 'success', not_fixed: 'danger', moved: 'info' } as const

function caretLine(el: HTMLElement): { first: boolean; last: boolean } {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return { first: true, last: true }
  const r = sel.getRangeAt(0).getBoundingClientRect()
  if (!r.height && !r.top) return { first: true, last: true }
  const box = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const line = parseFloat(cs.lineHeight) || 20
  return {
    first: r.top - box.top - parseFloat(cs.paddingTop) < line * 0.75,
    last: box.bottom - parseFloat(cs.paddingBottom) - r.bottom < line * 0.75,
  }
}

export const OutlineRow = memo(function OutlineRow(p: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  // The text the DOM shows: typing updates it before the change comes back,
  // so the round trip never rebuilds the point (and never moves the caret).
  const shown = useRef<string | null>(null)
  const caretAfter = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (shown.current === p.text && el.dataset.labels === p.labelKey) return
    const had = document.activeElement === el ? selectionOffsets(el)?.[0] ?? null : null
    render(el, p.text, p.labelOf)
    shown.current = p.text
    el.dataset.labels = p.labelKey
    const at = caretAfter.current ?? had
    caretAfter.current = null
    if (at != null) focusAtOffset(el, Math.min(at, p.text.length))
  }, [p.text, p.labelKey, p.labelOf])

  const sel = (): [number, number] => {
    const el = ref.current
    const len = el ? serialize(el).length : 0
    const o = el ? selectionOffsets(el) : null
    return o ?? [len, len]
  }
  const emit = (text: string, caret: number) => { shown.current = text; p.onText(p.id, text, caret) }
  const onInput = () => { const el = ref.current; if (el) emit(serialize(el), sel()[0]) }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || e.nativeEvent.isComposing) return
    const [a, b] = sel()
    const text = serialize(el)
    const command = (cmd: RowCommand) => { e.preventDefault(); p.onCommand(p.id, cmd, [a, b]) }
    if (e.key === 'Enter' && !e.shiftKey) return command('enter')
    if (e.key === 'Enter') {
      e.preventDefault()
      // A line break inside the point; never a blank line (that separates points).
      if (a === b && (a === 0 || text[a - 1] === '\n')) return
      caretAfter.current = a + 1
      p.onText(p.id, text.slice(0, a) + '\n' + text.slice(b), a + 1)
      return
    }
    if (e.key === 'Tab') return command(e.shiftKey ? 'outdent' : 'indent')
    if (e.key === 'Backspace' && a === 0 && b === 0) return command('backspace-start')
    if (e.key === 'Delete' && a === b && a === text.length) return command('delete-end')
    if (e.key === 'ArrowLeft' && !e.shiftKey && a === 0 && b === 0) return command('left')
    if (e.key === 'ArrowRight' && !e.shiftKey && a === b && a === text.length) return command('right')
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey) {
      const at = caretLine(el)
      if (e.key === 'ArrowUp' && at.first) return command('up')
      if (e.key === 'ArrowDown' && at.last) return command('down')
    }
    // No bold/italic/underline: a point holds text and links only.
    if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) e.preventDefault()
  }
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    p.onPaste(p.id, e.clipboardData.getData('text/plain'), sel())
  }
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as Element).closest?.(`[${REF_ATTR}]`)
    const id = link?.getAttribute(REF_ATTR)
    if (id) { e.preventDefault(); p.onOpenLink(id) }
  }
  const remember = () => { const el = ref.current; const o = el && selectionOffsets(el); if (el && o) lastCaret.set(el, o[0]) }

  const state = p.review?.review?.state ?? null
  const tone = state ? STATE_TONE[state] : undefined
  const note = tailNote(p.tail)
  const sub = p.level === 1

  const extras = p.tail || (p.review && (state === 'moved' || state === 'not_fixed'))
  return (
    <div className={cx('group/row flex flex-col gap-1.5 py-0.5 pr-0.5', sub ? 'ml-[1.15rem] border-l-2 border-line pl-2.5' : 'pl-0.5')}>
      <div className="flex items-start gap-2">
        <span
          data-tone={tone}
          aria-hidden
          className={cx(
            'mt-[3px] inline-flex h-6 shrink-0 items-center justify-center rounded-full px-1.5 text-meta font-semibold tabular-nums',
            sub ? 'min-w-[2.25rem]' : 'min-w-[1.75rem]',
            tone ? 'tone-soft tone-text' : 'bg-surface-2 text-fg-muted',
          )}
        >
          {p.label}
        </span>
        <div
          ref={el => { ref.current = el; p.register(p.id, el) }}
          role="textbox"
          aria-multiline="true"
          aria-label={p.ariaLabel}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          data-placeholder={p.placeholder}
          data-empty={p.text === '' ? '' : undefined}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={e => e.preventDefault()}
          onClick={onClick}
          onFocus={() => p.onFocusRow(p.id)}
          onKeyUp={remember}
          onMouseUp={remember}
          onBlur={remember}
          className={cx(
            'min-h-[30px] min-w-0 flex-1 cursor-text whitespace-pre-wrap break-words rounded-sm py-[3px] text-body leading-relaxed outline-none',
            state === 'fixed' || state === 'moved' ? 'text-fg-muted' : 'text-fg',
            'data-[empty]:before:pointer-events-none data-[empty]:before:text-fg-faint',
            p.alwaysPlaceholder
              ? 'data-[empty]:before:content-[attr(data-placeholder)]'
              : 'data-[empty]:focus:before:content-[attr(data-placeholder)]',
          )}
        />
        {p.review && state !== 'moved' && <ReviewToggle state={state} label={p.label} onSet={p.review.onSet} />}
      </div>
      {extras && (
        // Under the words, the full width of the row (lined up past the number).
        <div className={cx('flex flex-col gap-1.5', sub ? 'pl-[2.75rem]' : 'pl-9')}>
          {p.tail && (
            <div data-tone="danger" className="tone-soft rounded-r-control border-l-2 border-[rgb(var(--tone))] px-2.5 py-1.5">
              <p className="text-micro font-semibold uppercase tracking-[0.08em] tone-text">Still not fixed</p>
              <p className="text-meta text-fg-2">{note || 'No note was added.'}</p>
            </div>
          )}
          {p.review && state === 'moved' && (
            <button
              type="button"
              onClick={() => p.review?.review?.to && p.review.onOpenRequest(p.review.review.to)}
              disabled={!p.review.review?.to}
              title="Open the re-check request"
              className="flex min-h-[28px] items-center self-start [@media(pointer:coarse)]:min-h-[44px]"
            >
              <span data-tone="info" className="tone-pill gap-1">Moved to re-check<ArrowUpRight aria-hidden className="h-3 w-3 shrink-0" /></span>
            </button>
          )}
          {p.review && state === 'not_fixed' && (
            <NoteField
              key={p.review.review?.note ?? ''}
              initial={p.review.review?.note ?? ''}
              onCommit={n => { if (n !== (p.review?.review?.note ?? '')) p.review?.onSet({ state: 'not_fixed', ...(n ? { note: n } : {}) }) }}
            />
          )}
        </div>
      )}
    </div>
  )
})

const TOGGLE = 'grid h-7 w-7 place-items-center rounded-[8px] transition-colors duration-100 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 [&_svg]:h-4 [&_svg]:w-4'

/** Fixed / Not fixed for one point; tapping the picked one clears it. */
function ReviewToggle({ state, label, onSet }: { state: string | null; label: string; onSet: RowReview['onSet'] }) {
  const idle = 'text-fg-faint [@media(hover:hover)]:hover:bg-surface-hover [@media(hover:hover)]:hover:text-fg-2'
  return (
    <div role="group" aria-label={`Review point ${label}`} className="flex shrink-0 items-center gap-0.5 rounded-[10px] border border-line bg-surface p-0.5">
      <button
        type="button"
        data-tone="success"
        aria-pressed={state === 'fixed'}
        aria-label={`Point ${label} is fixed`}
        title={state === 'fixed' ? 'Fixed — tap to clear' : 'Fixed'}
        onClick={() => onSet(state === 'fixed' ? null : { state: 'fixed' })}
        className={cx(TOGGLE, state === 'fixed' ? 'tone-soft tone-text' : idle)}
      >
        <Check strokeWidth={2.75} />
      </button>
      <button
        type="button"
        data-tone="danger"
        aria-pressed={state === 'not_fixed'}
        aria-label={`Point ${label} is not fixed`}
        title={state === 'not_fixed' ? 'Not fixed — tap to clear' : 'Not fixed'}
        onClick={() => onSet(state === 'not_fixed' ? null : { state: 'not_fixed' })}
        className={cx(TOGGLE, state === 'not_fixed' ? 'tone-soft tone-text' : idle)}
      >
        <X strokeWidth={2.75} />
      </button>
    </div>
  )
}

/** What is still wrong — saved when you leave the field or press Enter. */
function NoteField({ initial, onCommit }: { initial: string; onCommit: (note: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <input
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => onCommit(value.trim())}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
      placeholder="What is still wrong? (optional)"
      aria-label="What is still wrong"
      data-tone="danger"
      className="input !min-h-[34px] border-l-2 !border-l-[rgb(var(--tone))] text-meta [@media(pointer:coarse)]:!min-h-[44px]"
    />
  )
}
