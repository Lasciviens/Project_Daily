import { Gift, HandCoins, PackageX, Repeat2, SearchX, Undo2, type LucideIcon } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { DISPOSAL_LABEL } from '../ownModel'
import type { ShopDisposal } from '../types'

/**
 * How a thing left, shown on its picture (owner, 23.11.2026: the "Sold or gone" pill blocked the record's title and
 * said nothing on the list — "a banner on both the main page and the edit page"). A picture of 5rem or more
 * (a big-picture card, the record) wears a neutral banner across its foot with the word — "Sold", "Given away",
 * "Returned", "Gone" (`DISPOSAL_LABEL`); a 28–40px picture of a row or a line wears a small neutral badge in its
 * corner with an icon, the word in its title and (`sr-only`) in the row's accessible name. Neutral tone, token
 * classes only.
 */
export function DisposalRibbon({ label, className }: { label: string; className?: string }) {
  return (
    <span data-tone="neutral" aria-hidden
      className={cx('tone-pill pointer-events-none absolute inset-x-0 bottom-0 z-[1] justify-center !rounded-none py-px text-micro font-semibold', className)}>
      {label}
    </span>
  )
}

const DISPOSAL_ICON: Record<ShopDisposal, LucideIcon> = {
  sold: HandCoins, traded_in: Repeat2, given: Gift, returned: Undo2, broken: PackageX, lost: SearchX, other: PackageX,
}

/** The small corner badge of a row's or a line's picture: an icon in the neutral tone; its title is the word. */
export function DisposalBadge({ disposal }: { disposal: ShopDisposal }) {
  const Icon = DISPOSAL_ICON[disposal]
  return (
    <span data-tone="neutral" title={DISPOSAL_LABEL[disposal]}
      className="tone-badge absolute bottom-0 right-0 z-[1] grid h-4 w-4 place-items-center rounded-tl-md">
      <Icon aria-hidden className="h-3 w-3" />
    </span>
  )
}
