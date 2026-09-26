import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'

/** Shown when a lazy chunk still can't load after the one reload lazyWithReload allows. */
export function ChunkLoadFailed() {
  return (
    <div role="alert" className="grid min-h-[100dvh] place-items-center bg-canvas p-6 text-center">
      <div className="max-w-sm">
        <p className="text-title font-semibold text-fg">This page couldn't be loaded</p>
        <p className="mt-1.5 text-body text-fg-muted">Check your connection, then reload to get the latest version of the app.</p>
        <Button variant="primary" icon={<RefreshCw />} onClick={() => window.location.reload()} className="mt-4">
          Reload
        </Button>
      </div>
    </div>
  )
}
