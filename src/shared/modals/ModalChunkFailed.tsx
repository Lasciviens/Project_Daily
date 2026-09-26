import { ModalShell } from './ModalShell'
import { Button } from '../ui/Button'
import { useModalStore } from './modalStore'

/** Shown when a popup's code can't load (offline, or a deploy swapped chunks). */
export function ModalChunkFailed() {
  const close = useModalStore(s => s.close)
  return (
    <ModalShell onClose={() => close()} size="xs" title="Couldn't open this">
      <p className="text-body text-fg-muted">Check your connection, then reload the app.</p>
      <div className="mt-4 flex gap-2">
        <Button block onClick={() => close()}>Close</Button>
        <Button block variant="primary" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </ModalShell>
  )
}
