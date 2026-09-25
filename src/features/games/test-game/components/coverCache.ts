// Box-art URLs this session already knows the outcome of.
//
// Module-level on purpose: a shelf re-chunk, a view switch or the detail panel
// remounting must neither re-request a URL that already failed (a dead Steam
// portrait 404s every time) nor flash a placeholder over an image the browser
// already has in its cache.
//
// In memory only, never localStorage: an <img> onError cannot tell a 404 from
// a network blip, so a persisted "dead" set would poison good URLs for every
// later session. One retry per URL (reportCoverError) absorbs the blips.

const failed = new Set<string>()
const loaded = new Set<string>()
const errored = new Set<string>()

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
 * Records a load error. The first error of a URL answers 'retry' (request it
 * once more); the second marks it dead for the session and answers 'dead'.
 */
export function reportCoverError(url: string): 'retry' | 'dead' {
  if (failed.has(url)) return 'dead'
  // Not "loaded" any more: the retry must stay hidden until it really loads.
  loaded.delete(url)
  if (!errored.has(url)) {
    errored.add(url)
    return 'retry'
  }
  markCoverFailed(url)
  return 'dead'
}

/** The first candidate not known to be dead, or null when every one failed. */
export function firstLiveCover(urls: readonly string[]): string | null {
  for (const url of urls) if (!failed.has(url)) return url
  return null
}
