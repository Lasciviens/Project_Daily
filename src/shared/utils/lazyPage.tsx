import { useState, type ComponentType } from 'react'
import { lazyWithReload } from './lazyWithReload'

export interface LazyPage {
  (): React.JSX.Element
  /** Loads the page's code ahead of time (idle time after start). */
  preload: () => Promise<void>
}

/**
 * A page whose code loads on demand. Once `preload` has run, the page renders
 * straight away: no Suspense fallback, so a view transition never slides in
 * a blank frame. Before that it is a lazyWithReload component (a chunk lost
 * in a deploy reloads once, then shows a reload card).
 */
export function lazyPage(name: string, load: () => Promise<ComponentType>): LazyPage {
  let Loaded: ComponentType | null = null
  let pending: Promise<void> | null = null
  const loadAndKeep = () => load().then(c => { Loaded = c; return c })
  const Lazy = lazyWithReload(name, loadAndKeep)

  function Page() {
    // Chosen once per mount: switching from Lazy to Loaded later would remount the page.
    const [C] = useState<ComponentType>(() => Loaded ?? Lazy)
    return <C />
  }
  Page.preload = () => (pending ??= loadAndKeep().then(() => undefined, () => { pending = null }))
  return Page
}
