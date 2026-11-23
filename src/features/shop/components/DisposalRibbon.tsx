import { cx } from '../../../shared/ui'

/**
 * How a thing left, as a small neutral corner ribbon across its picture's top-left corner (owner, 23.11.2026: the
 * "Sold or gone" pill blocked the record's title and said nothing on the list): "Sold", "Given away", "Returned",
 * "Gone" — the thing's own word (`DISPOSAL_LABEL`). The picture's box is `relative overflow-hidden`, so the band is
 * cut at its corner. Neutral tone, token classes only; for a picture at least 5rem wide.
 */
export function DisposalRibbon({ label, className }: { label: string; className?: string }) {
  return (
    <span data-tone="neutral" aria-hidden
      className={cx('tone-pill pointer-events-none absolute -left-[1.85rem] top-[0.6rem] z-[1] w-[6.5rem] -rotate-45 justify-center !rounded-none py-px text-micro font-semibold shadow-card', className)}>
      {label}
    </span>
  )
}
