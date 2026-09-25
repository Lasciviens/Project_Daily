import { Dices } from 'lucide-react'

/**
 * The icon-only "Pick a random game" button beside search. `onPick` is left
 * out when the current view has no games, which disables the button.
 */
export function TgRandomButton({ onPick, className = '' }: { onPick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!onPick}
      aria-label="Pick a random game"
      title="Pick a random game"
      className={`tg-icon-btn shrink-0 disabled:pointer-events-none disabled:opacity-35 ${className}`}
    >
      <Dices aria-hidden size={20} strokeWidth={1.9} />
    </button>
  )
}
