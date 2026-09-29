import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Check, X } from 'lucide-react'
import type { Checkpoint } from '../checkpoints'
import { IconButton, cx } from '../../../shared/ui'

interface Props {
  items: readonly Checkpoint[]
  onToggle: (index: number, done: boolean) => void
  /** Editable (the composer): the text is a field, with remove and Enter-to-add. */
  edit?: {
    onText: (index: number, text: string) => void
    onRemove: (index: number) => void
    onAddAfter: (index: number) => void
    /** Focus this row's field once rendered (the one just added). */
    focusIndex: number | null
    onFocused: () => void
  }
}

/** Checkpoints as checkboxes: ticked in the card, ticked and written in the composer. */
export function CheckpointList({ items, onToggle, edit }: Props) {
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const focusIndex = edit?.focusIndex ?? null
  const onFocused = edit?.onFocused
  useEffect(() => {
    if (focusIndex === null) return
    const el = inputs.current[focusIndex]
    if (!el) return
    el.focus({ preventScroll: false })
    onFocused?.()
  }, [focusIndex, onFocused, items.length])

  if (items.length === 0) return null
  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (!edit || e.nativeEvent.isComposing) return
    if (e.key === 'Enter') { e.preventDefault(); edit.onAddAfter(i) }
    else if (e.key === 'Backspace' && !items[i].text && items.length > 0) {
      e.preventDefault()
      edit.onRemove(i)
      requestAnimationFrame(() => inputs.current[Math.max(0, i - 1)]?.focus())
    }
  }

  return (
    <ul className="flex flex-col" aria-label="Checkpoints">
      {items.map((c, i) => (
        <li key={i} className="flex min-h-[44px] items-center gap-1">
          <button
            type="button"
            role="checkbox"
            aria-checked={c.done}
            aria-label={c.text ? `${c.done ? 'Done' : 'Not done'}: ${c.text}` : 'Checkpoint'}
            onClick={() => onToggle(i, !c.done)}
            className="grid min-h-[44px] min-w-[36px] shrink-0 place-items-center"
          >
            <span
              data-tone={c.done ? 'success' : undefined}
              className={cx(
                'grid h-4 w-4 place-items-center rounded-md border-2 transition-colors',
                c.done ? 'border-[rgb(var(--tone))] bg-[rgb(var(--tone))]' : 'border-line-strong bg-surface',
              )}
            >
              {c.done && <Check aria-hidden className="h-3 w-3 text-on-accent" strokeWidth={3} />}
            </span>
          </button>
          {edit ? (
            <>
              <input
                ref={el => { inputs.current[i] = el }}
                value={c.text}
                onChange={e => edit.onText(i, e.target.value)}
                onKeyDown={e => onKey(e, i)}
                placeholder="Checkpoint"
                aria-label={`Checkpoint ${i + 1}`}
                className={cx('input min-w-0 flex-1', c.done && 'text-fg-muted line-through')}
              />
              <IconButton label={`Remove checkpoint ${i + 1}`} onClick={() => edit.onRemove(i)} className="shrink-0 hover:!text-danger"><X /></IconButton>
            </>
          ) : (
            <span className={cx('min-w-0 flex-1 break-words text-body', c.done ? 'text-fg-faint line-through' : 'text-fg-2')}>{c.text}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
