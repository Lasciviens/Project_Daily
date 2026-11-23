import { cx } from '../../../shared/ui'

/**
 * How a thing left, as a neutral banner across the bottom of its picture (owner, 23.11.2026: the "Sold or gone" pill
 * blocked the record's title and said nothing on the list): "Sold", "Given away", "Returned", "Gone" — the thing's
 * own word (`DISPOSAL_LABEL`). The picture's box is `relative overflow-hidden`, so the band is cut at its rounded
 * corners. Neutral tone, token classes only; for a picture at least 5rem wide (a diagonal corner ribbon cut the
 * longer words — "Given away" — at 80px).
 */
export function DisposalRibbon({ label, className }: { label: string; className?: string }) {
  return (
    <span data-tone="neutral" aria-hidden
      className={cx('tone-pill pointer-events-none absolute inset-x-0 bottom-0 z-[1] justify-center !rounded-none py-px text-micro font-semibold', className)}>
      {label}
    </span>
  )
}
