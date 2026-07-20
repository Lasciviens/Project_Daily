import { useState } from 'react'
import { haptic } from '../../../shared/utils/haptics'

interface Props {
  /** Stored rating 1–10 (2 points per star). 0/undefined = unrated. */
  value?: number | null
  onChange: (value: number) => void
  disabled?: boolean
}

const STARS = [1, 2, 3, 4, 5]

/**
 * 5-star rating with half-star precision → 1–10 scale.
 * Hover glows yellow up to the cursor; click commits the selection.
 * Left half of star i = value 2i-1, right half = value 2i.
 */
export function StarRating({ value, onChange, disabled }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const fill = hover ?? value ?? 0

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-center"
        onMouseLeave={() => setHover(null)}
      >
        {STARS.map(i => {
          // Portion of this star that should be coloured (0, 50 or 100%).
          const portion = Math.max(0, Math.min(2, fill - (i - 1) * 2))
          const pct = (portion / 2) * 100
          return (
            // Cell is a full 44px-tall tap target (h-11) while the ★ glyph stays
            // visually small (text-2xl, centred via inset-0). Each half is a real
            // hit zone spanning the full height.
            <span key={i} className="relative inline-block w-9 h-11 leading-none">
              {/* Base (empty) star */}
              <span className="absolute inset-0 flex items-center justify-center text-2xl text-ink-300 select-none">★</span>
              {/* Filled overlay clipped to pct */}
              <span
                className="absolute inset-0 flex items-center justify-center text-2xl text-accent-500 select-none overflow-hidden"
                style={{ width: `${pct}%` }}
              >★</span>
              {/* Hover/click zones — left & right halves */}
              {!disabled && (
                <>
                  <button
                    type="button"
                    aria-label={`Rate ${i * 2 - 1}`}
                    onMouseEnter={() => setHover(i * 2 - 1)}
                    onClick={() => { haptic('light'); onChange(i * 2 - 1) }}
                    className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                  />
                  <button
                    type="button"
                    aria-label={`Rate ${i * 2}`}
                    onMouseEnter={() => setHover(i * 2)}
                    onClick={() => { haptic('light'); onChange(i * 2) }}
                    className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                  />
                </>
              )}
            </span>
          )
        })}
      </div>
      <span className="text-xs font-semibold text-ink-500 tabular-nums w-10">
        {fill > 0 ? `${fill}/10` : '—'}
      </span>
    </div>
  )
}
