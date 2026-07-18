import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'

// react-router's built-in `viewTransition` prop on Link/useNavigate only
// works with the data-router (`<RouterProvider><createBrowserRouter>`) — this
// app uses plain `HashRouter` (GitHub Pages has no server rewrite), so route
// transitions need to be wrapped manually. `document.startViewTransition`
// doesn't care about URL mechanics (hash vs. real navigation) — it just
// snapshots the DOM before/after a synchronous callback — but React 18
// batches state updates, so `flushSync` is required inside the callback or
// the "after" snapshot gets taken before the DOM actually updates, producing
// no visible transition at all.
//
// `direction` (optional): stamps data-vt-dir on <html> for the duration of
// the transition so index.css can slide the incoming page from the matching
// side (tab-order-aware, like a native tab switch) instead of the default
// crossfade. Cleaned up in `finished` regardless of outcome so a skipped/
// interrupted transition can't leave the attribute stuck for later ones.
export function useViewTransitionNav() {
  const navigate = useNavigate()

  return useCallback((to: string, direction?: 'forward' | 'back') => {
    if (!document.startViewTransition) {
      navigate(to)
      return
    }
    if (direction) document.documentElement.dataset.vtDir = direction
    const transition = document.startViewTransition(() => {
      flushSync(() => navigate(to))
    })
    transition.finished.finally(() => {
      delete document.documentElement.dataset.vtDir
    })
  }, [navigate])
}
