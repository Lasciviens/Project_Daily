import { useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { X } from 'lucide-react'
import { useHistoryDismiss } from '../../../../shared/hooks/useHistoryDismiss'
import { Truncate } from '../../../../shared/ui/Truncate'

// Same photo-overlay role as TgLightbox: black scrim in both themes.
const CONTROL = 'inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors [@media(hover:hover)]:hover:bg-white/20 active:bg-white/20'

/**
 * Full-screen player for a ScreenScraper video. The src is the signed
 * `screenscraper-media` proxy, which passes Range requests through, so the
 * browser's own controls can seek; nothing is stored.
 */
export function TgVideoPlayer({ src, title, onClose }: { src: string | null; title: string; onClose: () => void }) {
  const open = !!src
  // Keep the source while the dialog fades out.
  const [last, setLast] = useState(src)
  const [failed, setFailed] = useState(false)
  if (src && src !== last) { setLast(src); setFailed(false) }
  useHistoryDismiss(open, onClose)

  return (
    <Dialog open={open} onClose={onClose} aria-label={`Video: ${title}`} className="tg-portal relative z-modal">
      <DialogBackdrop transition className="fixed inset-0 bg-black/90 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-center justify-center p-[calc(env(safe-area-inset-top)+64px)_calc(env(safe-area-inset-right)+12px)_calc(env(safe-area-inset-bottom)+24px)_calc(env(safe-area-inset-left)+12px)] sm:px-20">
        <DialogPanel
          transition
          onClick={e => { if (e.target === e.currentTarget) onClose() }}
          className="flex h-full w-full flex-col items-center justify-center gap-3 outline-none transition-opacity duration-200 data-[closed]:opacity-0"
        >
          {last && !failed && (
            <video
              key={last}
              src={last}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onError={() => setFailed(true)}
              className="max-h-full max-w-full rounded-lg bg-black shadow-2xl"
            />
          )}
          {failed && (
            <p className="max-w-sm text-center text-[14px] text-white/80">
              The video could not be played. ScreenScraper may be busy, or the link has expired — close and open the game again.
            </p>
          )}
          <Truncate as="p" className="text-[13px] text-white/70">{`${title} · via ScreenScraper.fr`}</Truncate>
        </DialogPanel>
      </div>
      <button type="button" onClick={onClose} aria-label="Close video"
        className={`fixed right-[calc(env(safe-area-inset-right)+12px)] top-[calc(env(safe-area-inset-top)+12px)] z-10 sm:right-[calc(env(safe-area-inset-right)+20px)] sm:top-[calc(env(safe-area-inset-top)+20px)] ${CONTROL}`}>
        <X className="h-5 w-5" aria-hidden />
      </button>
    </Dialog>
  )
}
