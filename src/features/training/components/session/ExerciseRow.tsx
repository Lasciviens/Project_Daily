import type { ReactNode } from 'react'
import { ChevronDown, Dumbbell } from 'lucide-react'
import { Truncate, cx } from '../../../../shared/ui'
import { ExerciseThumb } from '../../exerciseMedia'

/** A 44px GIF slot that keeps every row aligned: a quiet placeholder under
 *  the thumbnail (which renders nothing when no GIF matches). The GIF is its
 *  own button (tap to enlarge), never nested inside the row's toggle — so it
 *  gets the full 44px tap target. */
function ThumbSlot({ title, templateId }: { title: string; templateId: string }) {
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-faint">
      <Dumbbell aria-hidden className="h-4 w-4" />
      <span className="absolute inset-0"><ExerciseThumb title={title} templateId={templateId} size={44} /></span>
    </span>
  )
}

/**
 * One exercise in the session popup: collapsed to a single line (GIF · name ·
 * a one-line summary), tap to expand its detail below. Rows expand
 * independently, so two lifts can be compared side by side.
 */
export function ExerciseRow({ title, templateId, meta, trailing, open, onToggle, children }: {
  title: string
  templateId: string
  meta: ReactNode
  /** Right of the text, before the chevron (a status pill). */
  trailing?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <li className="border-t border-line first:border-t-0">
      <div className="flex items-center gap-2.5">
        <ThumbSlot title={title} templateId={templateId} />
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <Truncate lines={2} className="text-body font-medium leading-snug text-fg">{title}</Truncate>
            <Truncate className="text-meta tabular-nums text-fg-muted">{meta}</Truncate>
          </span>
          {trailing}
          <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform duration-150', open && 'rotate-180')} />
        </button>
      </div>
      {open && <div className="pb-3 pl-[54px]">{children}</div>}
    </li>
  )
}
