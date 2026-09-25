// Loads proxied ScreenScraper media a few at a time.
//
// The account grants 7 threads and ScreenScraper answers 429 above that; a
// page of 30 search results would otherwise open 30 downloads at once. So
// every proxied image goes through this queue (3 at a time), is retried after
// a pause when their servers say busy (503 from the proxy), and the result is
// kept as an object URL for the session so a re-render or a remount never
// asks again. The browser's HTTP cache (the proxy sends a year-long,
// immutable Cache-Control) covers the next session.

const MAX_ACTIVE = 3
const MAX_KEPT = 300
const RETRY_DELAYS = [2000, 6000]

type Result = { url: string } | { error: 'missing' | 'failed' }
const done = new Map<string, Result>()
const pending = new Map<string, Promise<Result>>()
const waiting: (() => void)[] = []
let active = 0

function acquire(): Promise<void> {
  if (active < MAX_ACTIVE) { active++; return Promise.resolve() }
  return new Promise(resolve => waiting.push(() => { active++; resolve() }))
}
function release() {
  active--
  waiting.shift()?.()
}

function remember(src: string, r: Result) {
  done.set(src, r)
  if (done.size <= MAX_KEPT) return
  const oldest = done.keys().next().value as string
  const old = done.get(oldest)
  if (old && 'url' in old) URL.revokeObjectURL(old.url)
  done.delete(oldest)
}

async function fetchOnce(src: string): Promise<Result | 'retry'> {
  const res = await fetch(src, { mode: 'cors', credentials: 'omit' })
  if (res.ok) return { url: URL.createObjectURL(await res.blob()) }
  if (res.status === 404) return { error: 'missing' }
  if (res.status === 503 || res.status === 502 || res.status === 429) return 'retry'
  return { error: 'failed' }
}

/** A cached object URL for a proxied file, loading it through the queue. */
export function loadProxied(src: string): Promise<Result> {
  const hit = done.get(src)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(src)
  if (inflight) return inflight
  const p = (async (): Promise<Result> => {
    for (let attempt = 0; ; attempt++) {
      await acquire()
      let r: Result | 'retry'
      try { r = await fetchOnce(src) } catch { r = 'retry' } finally { release() }
      if (r !== 'retry') return r
      if (attempt >= RETRY_DELAYS.length) return { error: 'failed' }
      await new Promise(res => setTimeout(res, RETRY_DELAYS[attempt]))
    }
  })().then(r => {
    // A missing file stays missing; a failure (busy servers) may work later.
    if (!('error' in r && r.error === 'failed')) remember(src, r)
    pending.delete(src)
    return r
  })
  pending.set(src, p)
  return p
}

/** Synchronous peek, so an already-loaded image paints on its first frame. */
export function peekProxied(src: string): Result | undefined {
  return done.get(src)
}
