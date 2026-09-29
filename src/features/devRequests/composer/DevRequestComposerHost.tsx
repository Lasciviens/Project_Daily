import { Suspense, useEffect, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { useUIStore } from '../../../app/store'
import { useAuth } from '../../../shared/hooks/useAuth'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { lazyWithReload } from '../../../shared/utils/lazyWithReload'

// Once the chunk is in, the composer renders directly instead of through
// React.lazy: a lazy component suspends on its first render even when its
// module is already loaded, and React holds a revealed Suspense boundary back
// for ~300ms — the first "New" of a visit showed the window that late, and
// the typing in between went to the drawer's button.
let loaded: ComponentType | null = null
const loadComposer = () => import('./DevRequestComposer').then(m => { loaded = m.DevRequestComposer; return m.DevRequestComposer })
const LazyComposer = lazyWithReload('dev-request-composer', loadComposer, () => null)

function ComposerMount() {
  const [Composer] = useState<ComponentType>(() => loaded ?? LazyComposer)
  return <Composer />
}

const PUBLIC_ROUTES = ['/login', '/reset-password']

/**
 * Mounted once in the router, beside the routes — not in AppShell — so the
 * composer survives every navigation, pages outside the shell included. A
 * direct child of <body>, never a Headless UI Dialog: an open popup marks the
 * app root inert, but not this, so the composer keeps working over popups
 * and picking can point inside them. Its code loads when it is first needed:
 * on opening, or already while the Requests drawer is open.
 */
export function DevRequestComposerHost() {
  const open = useDevRequestDrafts(s => s.composer.open)
  const drawerOpen = useUIStore(s => s.isDevRequestsOpen)
  const { session } = useAuth()
  const { pathname } = useLocation()
  // Fetched while the Requests drawer is open, so "New" shows the composer at
  // once: waiting for the chunk left the first keystrokes on the drawer's
  // button. A failed preload is harmless — the lazy load retries and reports.
  useEffect(() => { if (drawerOpen && session) loadComposer().catch(() => {}) }, [drawerOpen, session])
  if (!open || !session || PUBLIC_ROUTES.includes(pathname)) return null
  return createPortal(
    <ErrorBoundary label="Request composer" action="dev_request_composer">
      <Suspense fallback={null}>
        <ComposerMount />
      </Suspense>
    </ErrorBoundary>,
    document.body,
  )
}
