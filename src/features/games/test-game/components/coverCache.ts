// Box-art URLs this session already knows the outcome of.
//
// Module-level on purpose: a shelf re-chunk, a view switch or the detail panel
// remounting must neither re-request a URL that already failed (a dead Steam
// portrait 404s every time) nor flash a placeholder over an image the browser
// already has in its cache.
//
// In memory only, never localStorage: an <img> onError cannot tell a 404 from
// a network blip, so a persisted "dead" set would poison good URLs for every
// later session. One background re-probe per URL (reportCoverError) absorbs
// the blips, and nothing is condemned while the device is offline.

const failed = new Set<string>()
const loaded = new Set<string>()
const errored = new Set<string>()
/** Errored once and being re-probed in the background: skipped meanwhile. */
const suspect = new Set<string>()

// A cover re-renders only when one of ITS candidate URLs settles (a probe
// answers) — a shelf of 1,000 covers must not all re-render per dead URL —
// or when the network comes back (everything gets another chance).
const byUrl = new Map<string, Set<() => void>>()
export function subscribeCoverUrls(urls: readonly string[], listener: () => void): () => void {
  for (const u of urls) {
    let set = byUrl.get(u)
    if (!set) byUrl.set(u, (set = new Set()))
    set.add(listener)
  }
  return () => {
    for (const u of urls) {
      const set = byUrl.get(u)
      set?.delete(listener)
      if (set && !set.size) byUrl.delete(u)
    }
  }
}
function emitUrl(url: string) { byUrl.get(url)?.forEach(l => l()) }
function emitAll() { new Set([...byUrl.values()].flatMap(s => [...s])).forEach(l => l()) }

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false

// Back online: what failed during the outage gets one more chance.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!failed.size && !errored.size) return
    failed.clear()
    errored.clear()
    emitAll()
  })
}

/** Re-requests a suspect URL off-screen; its answer decides, not a timer. */
function probe(url: string) {
  const img = new Image()
  img.onload = () => {
    suspect.delete(url)
    if (img.naturalWidth >= 16 && img.naturalHeight >= 16) markCoverLoaded(url)
    else markCoverFailed(url)
    emitUrl(url)
  }
  img.onerror = () => {
    suspect.delete(url)
    // Offline is not evidence against the URL.
    if (online()) markCoverFailed(url)
    emitUrl(url)
  }
  img.src = url
}

export function markCoverFailed(url: string): void {
  failed.add(url)
  loaded.delete(url)
  errored.delete(url)
}

export function markCoverLoaded(url: string): void {
  loaded.add(url)
  failed.delete(url)
  errored.delete(url)
}

export function isCoverLoaded(url: string | null): boolean {
  return url != null && loaded.has(url)
}

export function isCoverFailed(url: string): boolean {
  return failed.has(url)
}

/**
 * Records a load error. The first error of a URL answers 'retry': the URL is
 * probed again in the background and skipped until the probe answers (so a
 * card moves to its next candidate at once instead of waiting); a later error
 * marks it dead for the session and answers 'dead' — unless the device is
 * offline, which says nothing about the URL.
 */
export function reportCoverError(url: string): 'retry' | 'dead' {
  if (failed.has(url)) return 'dead'
  // Not "loaded" any more: the retry must stay hidden until it really loads.
  loaded.delete(url)
  if (!errored.has(url)) {
    errored.add(url)
    if (!suspect.has(url)) { suspect.add(url); probe(url) }
    return 'retry'
  }
  if (online()) markCoverFailed(url)
  return 'dead'
}

/** The first candidate not known (or suspected) to be dead, or null. */
export function firstLiveCover(urls: readonly string[]): string | null {
  for (const url of urls) if (!failed.has(url) && !suspect.has(url)) return url
  return null
}
