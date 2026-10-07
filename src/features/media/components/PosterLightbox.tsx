import { ModalShell } from '../../../shared/modals/ModalShell'
import { posterUrl } from '../../../integrations/tmdb/client'

/** The title's poster, big, in its own popup over the title popup (Esc / Back / ✕ close it). */
export function PosterLightbox({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  return (
    <ModalShell onClose={onClose} size="md" title={title} ariaLabel={`${title} poster`}>
      <div className="flex justify-center p-3 sm:p-4">
        <img
          src={posterUrl(path, 'w780')}
          alt={`${title} poster`}
          className="max-h-[75dvh] w-auto max-w-full rounded-row bg-surface-2 object-contain"
        />
      </div>
    </ModalShell>
  )
}
