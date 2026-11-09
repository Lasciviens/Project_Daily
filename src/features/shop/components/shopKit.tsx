import { useState, type ReactNode } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { ExternalLink, Package } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { complete, type Amount } from '../ownModel'
import { amountReason, hostOf, money, num, pendingWords, webUrl } from './shopFormat'

// Shop's shared display pieces: an Amount that is never shown as a number
// unless it is complete, a value with a detail on demand, and an item's
// picture (helpers in shopFormat.ts).

/**
 * "4 500 NOK" when the sum is complete; "20 100 NOK + 4 500 TRY pending" when
 * only a rate is waiting (the waiting part muted, never at today's rate); else
 * `unknown` ("Unknown") — the reason on hover / long-press either way.
 * `pending="unknown"` keeps a narrow cell to `unknown` instead; `bare` leaves
 * " NOK" off a complete sum where the line already says it is NOK.
 */
export function AmountText({ amount, signed = false, className, unknown = 'Unknown', pending = 'sum', bare = false }: {
  amount: Amount; signed?: boolean; className?: string; unknown?: ReactNode; pending?: 'sum' | 'unknown'; bare?: boolean
}) {
  if (!complete(amount)) {
    const words = pending === 'sum' ? pendingWords(amount, signed) : null
    if (words) {
      return (
        <span className={cx('tabular-nums', className)} title={amountReason(amount)}>
          {words.known && <span className="whitespace-nowrap">{words.known}</span>}
          {words.known && ' '}
          <span className="whitespace-nowrap font-normal text-fg-muted">{words.waiting}</span>
        </span>
      )
    }
    return <span className={cx('text-fg-muted', className)} title={amountReason(amount)}>{unknown}</span>
  }
  const n = Math.round(amount.nok)
  return <span className={cx('whitespace-nowrap tabular-nums', className)}>{signed && n > 0 ? '+' : ''}{bare ? num(n) : money(n)}</span>
}

/**
 * The product's page, opened in a new tab: "power.no ↗" (or `children`).
 * Only a web link (http or https) becomes a link; anything else is plain text.
 */
export function SiteLink({ url, children, className }: { url: string | null | undefined; children?: ReactNode; className?: string }) {
  const href = webUrl(url)
  const label = children ?? hostOf(url) ?? 'the shop'
  if (!href) return <span className={className}>{label}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={cx('inline-flex items-center gap-0.5 font-semibold text-accent-600 hover:underline', className)}>
      {label}<ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
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

/**
 * A value with a detail on demand (THEME W5), e.g. the day behind "4 000 NOK":
 * the mouse sees it as a tooltip, a tap or click opens it in a small bubble.
 */
export function Peek({ detail, children, className }: { detail: string; children: ReactNode; className?: string }) {
  return (
    <Popover as="span" className="inline">
      <PopoverButton data-peek title={detail}
        className={cx('rounded-sm text-left underline decoration-line-strong decoration-dotted underline-offset-2 hover:decoration-fg-faint', className)}>
        {children}
      </PopoverButton>
      <PopoverPanel anchor="bottom" className="z-popover rounded-menu border border-line-strong bg-surface px-2.5 py-1.5 text-meta tabular-nums text-fg-2 shadow-menu [--anchor-gap:4px]">
        {detail}
      </PopoverPanel>
    </Popover>
  )
}
