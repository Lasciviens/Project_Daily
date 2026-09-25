import { ChevronsRight, X } from 'lucide-react'

interface Props {
  title: string
  onCollapse: () => void
  onClose: () => void
}

// 36px on a mouse, 44px on touch. Hover tints only where a pointer can hover:
// on touch a :hover sticks to the last tapped button.
const BUTTON =
  'grid h-9 w-9 place-items-center rounded-full text-[var(--tg-text-2)] transition-colors ' +
  '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ' +
  '[@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:hover)]:hover:text-[var(--tg-text)] ' +
  'active:bg-[var(--tg-hover)] focus-visible:!rounded-full'

/**
 * The overlay's two corner controls, floating over the hero art on a frosted
 * pill so they read on any picture: tuck the overlay into its tab, or close it.
 */
export function TgDetailOverlayControls({ title, onCollapse, onClose }: Props) {
  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-full border border-[var(--tg-border)] bg-[color-mix(in_srgb,var(--tg-panel)_72%,transparent)] p-0.5 shadow-[shadow:var(--tg-chevron-shadow)] backdrop-blur-md">
      <button type="button" onClick={onCollapse} aria-label={`Collapse ${title} details`} title="Collapse" className={BUTTON}>
        <ChevronsRight aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />
      </button>
      <span aria-hidden className="h-4 w-px bg-[var(--tg-border-strong)]" />
      <button type="button" onClick={onClose} aria-label={`Close ${title} details`} title="Close (Esc)" className={BUTTON}>
        <X aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />
      </button>
    </div>
  )
}
