import { lazy, type ComponentType } from 'react'
import { ChunkLoadFailed } from '../components/ChunkLoadFailed'
import { logError } from './logError'

// A lazy chunk can fail to load after a deploy: skipWaiting + clientsClaim
// (vite.config.ts) swap the service worker under an open tab, whose old entry
// bundle still asks for a chunk hash the server no longer has. The first
// failure reloads the page once (fresh index.html, fresh hashes); a
// sessionStorage flag stops that from ever looping, and a second failure shows
// `Failed` (a plain reload prompt by default) instead of a blank page.

// One flag PER CHUNK: with a shared flag, any other chunk loading fine cleared
// it, so a chunk that kept failing reloaded the page on every attempt.
const flagOf = (name: string) => `lasci.chunk-reload:${name}`

/** Records the one reload we allow; false when it was already spent — or when
 *  storage is blocked, since a reload we cannot record could loop forever. */
function markReloadAttempt(name: string): boolean {
  try {
    if (sessionStorage.getItem(flagOf(name)) === '1') return false
    sessionStorage.setItem(flagOf(name), '1')
    return true
  } catch {
    return false
  }
}

/** `name` identifies the chunk (its own reload-once flag); `Failed` is shown when it still can't load. */
export function lazyWithReload<P extends object>(name: string, load: () => Promise<ComponentType<P>>, Failed: ComponentType = ChunkLoadFailed) {
  return lazy(async (): Promise<{ default: ComponentType<P> }> => {
    try {
      const component = await load()
      try { sessionStorage.removeItem(flagOf(name)) } catch { /* storage blocked: nothing to clear */ }
      return { default: component }
    } catch (err) {
      // Logged either way: a stale chunk after a deploy is expected, but an
      // exception thrown while the module evaluates lands here too, and
      // without a record it would only ever look like "check your connection".
      void logError((err as Error)?.message ?? 'Lazy chunk failed to load', { action: 'lazy_route_load', chunk: name })
      if (markReloadAttempt(name)) {
        window.location.reload()
        return new Promise(() => {}) // keep the fallback up until the reload lands
      }
      return { default: Failed as ComponentType<P> }
    }
  })
}
