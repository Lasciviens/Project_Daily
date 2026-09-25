import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { formatStars } from '../testGameModel'

interface Props {
  stars: number | null
  size?: number
  className?: string
  /** Omit for a read-only rating. */
  onChange?: (stars: number | null) => void
}

const STAR = 'M12 2.6l2.9 5.88 6.5.95-4.7 4.58 1.1 6.47L12 17.43l-5.8 3.05 1.1-6.47-4.7-4.58 6.5-.95z'
const POSITIONS = [1, 2, 3, 4, 5]

/** One star glyph, `fill` of it (0–1) in the star colour over the empty one. */
export function TgStarIcon({ size = 14, fill = 1 }: { size?: number; fill?: number }) {
  return (
    <span aria-hidden className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} className="absolute inset-0 text-[var(--tg-star-empty)]">
        <path d={STAR} fill="currentColor" />
      </svg>
      {fill > 0 && (
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${Math.min(1, fill) * 100}%` }}>
          <svg viewBox="0 0 24 24" width={size} height={size} className="max-w-none text-[var(--tg-star)]">
            <path d={STAR} fill="currentColor" />
          </svg>
        </span>
      )}
    </span>
  )
}

const describe = (stars: number | null) => (stars == null ? 'Not rated' : `${formatStars(stars)} of 5 stars`)
const fillOf = (value: number, position: number) => Math.max(0, Math.min(1, value - (position - 1)))

/** Left half of star n means n − 0.5, right half means n. */
function valueAt(e: MouseEvent<HTMLElement>, position: number): number {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientX < r.left + r.width / 2 ? position - 0.5 : position
}

/**
 * Five stars with half steps. Interactive when `onChange` is given: hover
 * previews, a click on the left half of a star sets n − 0.5 and on the right
 * half n, clicking the current value clears it, and Left/Right step by 0.5.
 */
export function TgStars({ stars, size = 14, className = '', onChange }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? stars ?? 0

  if (!onChange) {
    return (
      <span role="img" aria-label={describe(stars)} className={`inline-flex items-center gap-[2px] ${className}`}>
        {POSITIONS.map(n => <TgStarIcon key={n} size={size} fill={fillOf(stars ?? 0, n)} />)}
      </span>
    )
  }

  const commit = (value: number | null) => {
    setHover(null)
    onChange(value === stars ? null : value)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = stars ?? 0
    let next: number | null | undefined
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, current + 0.5)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = current - 0.5 > 0 ? current - 0.5 : null
    else if (e.key === 'End') next = 5
    else if (e.key === 'Home') next = 0.5
    else if (e.key === 'Delete' || e.key === 'Backspace') next = null
    if (next === undefined) return
    e.preventDefault()
    if (next !== stars) onChange(next)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="My rating"
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={stars ?? 0}
      aria-valuetext={describe(stars)}
      onKeyDown={onKeyDown}
      onPointerLeave={() => setHover(null)}
      className={`inline-flex min-h-[44px] cursor-pointer items-center rounded-md ${className}`}
    >
      {POSITIONS.map(n => (
        <span
          key={n}
          className="flex items-center self-stretch px-px"
          onPointerMove={e => { if (e.pointerType === 'mouse') setHover(valueAt(e, n)) }}
          onClick={e => commit(valueAt(e, n))}
        >
          <TgStarIcon size={size} fill={fillOf(shown, n)} />
        </span>
      ))}
    </div>
  )
}
