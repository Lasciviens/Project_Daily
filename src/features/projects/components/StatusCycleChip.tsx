import { haptic } from '../../../shared/utils/haptics'
import { TonePill, type Tone } from '../../../shared/ui'

interface Props<T extends string> {
  value:   T
  options: readonly T[]
  tones:   Record<T, Tone>
  labels?: Partial<Record<T, string>>
  onCycle: (next: T) => void
}

const labelOf = <T extends string>(v: T, labels?: Partial<Record<T, string>>) => labels?.[v] ?? v.replace('_', ' ')

/** A status pill that advances to the next status on tap. */
export function StatusCycleChip<T extends string>({ value, options, tones, labels, onCycle }: Props<T>) {
  const idx = options.indexOf(value)
  const next = idx === -1 ? null : options[(idx + 1) % options.length]

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!next) return
    haptic('light')
    onCycle(next)
  }

  // The pill stays compact; the transparent button around it is the 44px target on touch.
  return (
    <button
      type="button"
      onClick={handleClick}
      title={next ? `Next: ${labelOf(next, labels)}` : undefined}
      aria-label={`Status: ${labelOf(value, labels)}${next ? ` — change to ${labelOf(next, labels)}` : ''}`}
      className="flex shrink-0 items-center justify-center transition-opacity hover:opacity-80 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
    >
      <TonePill tone={tones[value] ?? 'neutral'} className="capitalize">{labelOf(value, labels)}</TonePill>
    </button>
  )
}
