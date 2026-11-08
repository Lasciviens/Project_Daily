import { useState, type ComponentType } from 'react'
import { lazyWithReload } from './lazyWithReload'

export interface LazyPart<P extends object> {
  (props: P): React.JSX.Element
  /** Loads the code ahead of time (idle time after start). */
  preload: () => Promise<void>
  /** True once the code is in (it then renders without suspending). */
  isLoaded: () => boolean
}

export type LazyPage = LazyPart<object>

/**
 * A component whose code loads on demand: a page, or a part of one that a
 * visit may never open (a tab, a sheet). Once `preload` has run, it renders
 * straight away: no Suspense fallback, so a view transition never slides in a
 * blank frame and a tab opens at once. Before that it is a lazyWithReload
 * component (a chunk lost in a deploy reloads once, then shows a reload card)
 * and suspends: a part needs a Suspense boundary of its own (pages have the
 * shell's).
 */
export function lazyPart<P extends object>(name: string, load: () => Promise<ComponentType<P>>): LazyPart<P> {
  let Loaded: ComponentType<P> | null = null
  let pending: Promise<void> | null = null
  const loadAndKeep = () => load().then(c => { Loaded = c; return c })
  const Lazy = lazyWithReload<P>(name, loadAndKeep) as ComponentType<P>

  function Part(props: P) {
    // Chosen once per mount: switching from Lazy to Loaded later would remount it.
    const [C] = useState<ComponentType<P>>(() => Loaded ?? Lazy)
    return <C {...props} />
  }
  Part.preload = () => (pending ??= loadAndKeep().then(() => undefined, () => { pending = null }))
  Part.isLoaded = () => Loaded != null
  return Part
}

/** A page of the app: an entry in src/app/pages.ts. */
export function lazyPage(name: string, load: () => Promise<ComponentType>): LazyPage {
  return lazyPart<object>(name, load)
}
