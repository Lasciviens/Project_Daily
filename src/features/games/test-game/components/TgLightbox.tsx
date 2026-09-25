import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

// White-on-black is the photo-overlay role (CLAUDE.md → Dark Mode): the
// scrim is black in both themes, so its controls are not theme tokens.
const CONTROL = 'inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20'
const SWIPE_PX = 48

interface Props {
  images: string[]
  index: number | null
  onClose: () => void
  onIndex: (i: number) => void
}

/** Full-screen screenshot viewer: arrows, Esc, swipe, and a counter. */
export function TgLightbox({ images, index, onClose, onIndex }: Props) {
  // Keep the last picture while the dialog fades out — `index` is already null.
  const [lastIndex, setLastIndex] = useState(index)
  if (index != null && index !== lastIndex) setLastIndex(index)

  const swipeFrom = useRef<number | null>(null)
  const count = images.length
  const i = Math.min(index ?? lastIndex ?? 0, Math.max(0, count - 1))
  const open = index != null && count > 0
  const many = count > 1

  function go(step: number) {
    if (many) onIndex((i + step + count) % count)
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
  }
  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse') swipeFrom.current = e.clientX
  }
  function onPointerUp(e: PointerEvent) {
    const from = swipeFrom.current
    swipeFrom.current = null
    if (from == null) return
    const dx = e.clientX - from
    if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1)
  }

  return (
    <Dialog open={open} onClose={onClose} className="tg-portal relative z-[90]">
      <DialogBackdrop transition className="fixed inset-0 bg-black/90 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-center justify-center p-3 pt-[calc(env(safe-area-inset-top)+64px)] pb-[calc(env(safe-area-inset-bottom)+64px)] sm:px-20 sm:py-16">
        <DialogPanel
          transition
          aria-label="Screenshot viewer"
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { swipeFrom.current = null }}
          // The panel fills the screen, so Headless UI's outside-click never
          // fires; a click on the empty scrim around the picture closes instead.
          onClick={e => { if (e.target === e.currentTarget) onClose() }}
          // Opacity only: a transform here would re-anchor the fixed controls.
          className="flex h-full w-full touch-pan-y items-center justify-center outline-none transition-opacity duration-200 data-[closed]:opacity-0"
        >
          {count > 0 && (
            <img
              key={images[i]}
              src={images[i]}
              alt={`Screenshot ${i + 1} of ${count}`}
              decoding="async"
              className="tg-fade-in max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
              draggable={false}
            />
          )}

          <button type="button" onClick={onClose} aria-label="Close" className={`${CONTROL} fixed right-3 top-[calc(env(safe-area-inset-top)+12px)] sm:right-5 sm:top-5`}>
            <X aria-hidden className="h-5 w-5" strokeWidth={2} />
          </button>
          {many && (
            <>
              <button type="button" onClick={() => go(-1)} aria-label="Previous screenshot" className={`${CONTROL} fixed left-3 top-1/2 -translate-y-1/2 sm:left-5`}>
                <ChevronLeft aria-hidden className="h-6 w-6" strokeWidth={2} />
              </button>
              <button type="button" onClick={() => go(1)} aria-label="Next screenshot" className={`${CONTROL} fixed right-3 top-1/2 -translate-y-1/2 sm:right-5`}>
                <ChevronRight aria-hidden className="h-6 w-6" strokeWidth={2} />
              </button>
              <p aria-live="polite" className="fixed bottom-[calc(env(safe-area-inset-bottom)+20px)] left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold tabular-nums text-white">
                {i + 1} / {count}
              </p>
            </>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
