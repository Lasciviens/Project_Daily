import { useState, type ReactNode } from 'react'
import { Package } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { complete, type Amount } from '../ownModel'
import { amountReason, money } from './shopFormat'

// Shop's shared display pieces: an Amount that is never shown as a number
// unless it is complete, and an item's picture (helpers in shopFormat.ts).

/** "4 500 NOK" when the sum is complete, else "Unknown" with the reason on hover/long-press. */
export function AmountText({ amount, signed = false, className, unknown = 'Unknown' }: { amount: Amount; signed?: boolean; className?: string; unknown?: ReactNode }) {
  if (!complete(amount)) {
    return <span className={cx('text-fg-muted', className)} title={amountReason(amount)}>{unknown}</span>
  }
  const n = Math.round(amount.nok)
  return <span className={cx('tabular-nums', className)}>{signed && n > 0 ? '+' : ''}{money(n)}</span>
}

/** A square picture with a quiet placeholder; a picture that fails to load falls back too. */
export function ItemThumb({ src, size = 'md', className }: { src: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const [failed, setFailed] = useState(false)
  const box = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-20 w-20' : 'h-12 w-12'
  return (
    <span className={cx('grid shrink-0 place-items-center overflow-hidden rounded-row border border-line bg-surface-2', box, className)}>
      {src && !failed
        ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain" />
        : <Package aria-hidden className={cx('text-fg-faint', size === 'lg' ? 'h-7 w-7' : 'h-4 w-4')} />}
    </span>
  )
}
