import { useEffect, useState } from 'react'

/**
 * #41 — offline indicator. A small pill that appears when the browser goes
 * offline (navigator.onLine + online/offline events) so a failed save reads as
 * "you're offline" rather than a mystery error. The service worker already
 * precaches the app shell, so the UI keeps working; this just sets expectations.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  )
  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!offline) return null
  return (
    <div
      role="status"
      data-tone="danger"
      className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-toast flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-surface px-3.5 py-2 text-meta font-medium text-fg shadow-menu"
    >
      <span className="tone-dot" aria-hidden />
      You're offline — changes won't save until you reconnect
    </div>
  )
}
