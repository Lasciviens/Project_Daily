import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { REF_RE } from '../devRequestMarks'
import { REF_ATTR, focusAtOffset, lastCaret, render, selectionOffsets, serialize } from './linkedTextDom'
import { cx } from '../../../shared/ui'

// The request's text box, with links to picked spots in it. The value is
// plain text where a link is `[[@id]]`; on screen the link is its name
// (blue, underlined) and behaves as one character — typing flows around it,
// Backspace removes it whole, a click opens the spot. Enter and paste insert
// plain text through the value (never browser markup), so the text box can
// only ever hold text and links.

interface Props {
  value: string
  onChange: (value: string) => void
  /** The name a link shows. */
  labelOf: (id: string) => string
  /** A link was clicked. */
  onOpenLink: (id: string) => void
  editorRef?: RefObject<HTMLDivElement | null>
  placeholder?: string
  ariaLabel: string
  className?: string
}

export function LinkedTextEditor({ value, onChange, labelOf, onOpenLink, editorRef, placeholder, ariaLabel, className }: Props) {
  const ownRef = useRef<HTMLDivElement | null>(null)
  const ref = editorRef ?? ownRef
  // The value the DOM shows; typing updates it before onChange, so a
  // re-render with the same value never rebuilds (and never moves the caret).
  const shown = useRef<string | null>(null)
  const caretAfter = useRef<number | null>(null)
  const labelKey = Array.from(value.matchAll(REF_RE), m => `${m[1]}=${labelOf(m[1])}`).join('|')

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const rebuild = shown.current !== value || root.dataset.labels !== labelKey
    if (rebuild) {
      const had = document.activeElement === root ? selectionOffsets(root)?.[0] ?? null : null
      render(root, value, labelOf)
      shown.current = value
      root.dataset.labels = labelKey
      const at = caretAfter.current ?? had
      caretAfter.current = null
      if (at != null) focusAtOffset(root, Math.min(at, value.length))
    }
  }, [value, labelKey, labelOf, ref])

  const emit = (next: string) => { shown.current = next; onChange(next) }
  const onInput = () => { if (ref.current) emit(serialize(ref.current)) }
  const replaceSelection = (text: string) => {
    const root = ref.current
    if (!root) return
    const current = serialize(root)
    const [a, b] = selectionOffsets(root) ?? [current.length, current.length]
    caretAfter.current = a + text.length
    onChange(current.slice(0, a) + text + current.slice(b))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); replaceSelection('\n'); return }
    // No bold/italic/underline: the box holds text and links only.
    if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) e.preventDefault()
  }
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    replaceSelection(e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'))
  }
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as Element).closest?.(`[${REF_ATTR}]`)
    const id = link?.getAttribute(REF_ATTR)
    if (id) { e.preventDefault(); onOpenLink(id) }
  }
  const remember = () => { const root = ref.current; const o = root && selectionOffsets(root); if (root && o) lastCaret.set(root, o[0]) }

  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      data-empty={value === '' ? '' : undefined}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDrop={e => e.preventDefault()}
      onClick={onClick}
      onKeyUp={remember}
      onMouseUp={remember}
      onBlur={remember}
      className={cx(
        'input cursor-text overflow-y-auto whitespace-pre-wrap break-words py-2 leading-relaxed',
        'data-[empty]:before:pointer-events-none data-[empty]:before:text-fg-faint data-[empty]:before:content-[attr(data-placeholder)]',
        className,
      )}
    />
  )
}
