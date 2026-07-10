import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, type NavigateOptions } from 'react-router-dom'

// react-router's built-in `viewTransition` prop on Link/useNavigate only
// works with the data-router (`<RouterProvider><createBrowserRouter>`) — this
// app uses plain `HashRouter` (GitHub Pages has no server rewrite), so route
// transitions need to be wrapped manually. `document.startViewTransition`
// doesn't care about URL mechanics (hash vs. real navigation) — it just
// snapshots the DOM before/after a synchronous callback — but React 18
// batches state updates, so `flushSync` is required inside the callback or
// the "after" snapshot gets taken before the DOM actually updates, producing
// no visible transition at all.
export function useViewTransitionNav() {
  const navigate = useNavigate()

  return useCallback((to: string, opts?: NavigateOptions) => {
    if (!document.startViewTransition) {
      navigate(to, opts)
      return
    }
    document.startViewTransition(() => {
      flushSync(() => navigate(to, opts))
    })
  }, [navigate])
}
