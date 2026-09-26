import { useEffect } from 'react'
import { Dices } from 'lucide-react'
import { dialogIsOpen, isTypingTarget } from './tgKeys'

/**
 * The icon-only "Pick a random game" button beside search. `onPick` is left
 * out when the current view has no games, which disables the button.
 */
export function TgRandomButton({ onPick, count, className = '' }: { onPick?: () => void; count?: number; className?: string }) {
  // "r" picks too — the same guards as "/" (never while typing or in a dialog).
  useEffect(() => {
    if (!onPick) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || dialogIsOpen(e.target)) return
      e.preventDefault()
      onPick()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPick])
  const label = count != null ? `Pick a random game from the ${count.toLocaleString('en-GB')} shown (R)` : 'Pick a random game (R)'
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!onPick}
      aria-label={label}
      title={label}
      className={`tg-icon-btn shrink-0 disabled:pointer-events-none disabled:opacity-35 ${className}`}
    >
      <Dices aria-hidden size={20} strokeWidth={1.9} />
    </button>
  )
}
