import { Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { useAuth } from '../../../shared/hooks/useAuth'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { lazyWithReload } from '../../../shared/utils/lazyWithReload'

const DevRequestComposer = lazyWithReload(
  'dev-request-composer',
  () => import('./DevRequestComposer').then(m => m.DevRequestComposer),
  () => null,
)

const PUBLIC_ROUTES = ['/login', '/reset-password']

/**
 * Mounted once in the router, beside the routes — not in AppShell — so the
 * composer survives every navigation, pages outside the shell included. A
 * direct child of <body>, never a Headless UI Dialog: an open popup marks the
 * app root inert, but not this, so the composer keeps working over popups
 * and picking can point inside them. Its code loads only once it is opened.
 */
export function DevRequestComposerHost() {
  const open = useDevRequestDrafts(s => s.composer.open)
  const { session } = useAuth()
  const { pathname } = useLocation()
  if (!open || !session || PUBLIC_ROUTES.includes(pathname)) return null
  return createPortal(
    <ErrorBoundary label="Request composer" action="dev_request_composer">
      <Suspense fallback={null}>
        <DevRequestComposer />
      </Suspense>
    </ErrorBoundary>,
    document.body,
  )
}
