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
      className="fixed left-1/2 -translate-x-1/2 z-[9998] top-[calc(env(safe-area-inset-top)+0.5rem)] flex items-center gap-2 rounded-full bg-ink-800 px-3.5 py-2 text-xs font-medium text-white shadow-lg"
    >
      <span className="h-2 w-2 rounded-full bg-red-400" />
      You’re offline — changes won’t save until you reconnect
    </div>
  )
}
