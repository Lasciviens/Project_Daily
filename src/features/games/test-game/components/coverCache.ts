// Box-art URLs this session already knows the outcome of.
//
// Module-level on purpose: a shelf re-chunk, a view switch or the detail panel
// remounting must neither re-request a URL that already failed (a dead Steam
// portrait 404s every time) nor flash a skeleton over an image the browser
// already has in its cache.

const failed = new Set<string>()
const loaded = new Set<string>()

export function markCoverFailed(url: string): void {
  failed.add(url)
  loaded.delete(url)
}

export function markCoverLoaded(url: string): void {
  loaded.add(url)
}

export function isCoverLoaded(url: string | null): boolean {
  return url != null && loaded.has(url)
}

/** The first candidate not known to be dead, or null when every one failed. */
export function firstLiveCover(urls: readonly string[]): string | null {
  for (const url of urls) if (!failed.has(url)) return url
  return null
}
