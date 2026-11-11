import { useEffect, useState } from 'react'
import type { iconFor } from '../components/categoryIcons'

// The default pictures live in their own chunk (the icons and the taxonomy
// would weigh on the Shop page's first download): asked for once, by the
// first Wishlist that opens, while its reads are still out.

type PictureFor = typeof iconFor
let loaded: PictureFor | null = null
let failed = false
let pending: Promise<void> | null = null

function load(): Promise<void> {
  pending ??= import('../components/categoryIcons')
    .then(m => { loaded = m.iconFor })
    .catch(() => { failed = true })
  return pending
}

/**
 * `pictureFor(top, sub)` — a category path's default picture — once its chunk
 * is here; `ready` once that is settled either way (a chunk that can't load
 * leaves the initials, never a wait that stays). The tiles wait for `ready`
 * with their own reads, so a picture never pops in under a drawn tile.
 */
export function useCategoryPictures(): { pictureFor: PictureFor | null; ready: boolean } {
  const [, settled] = useState(0)
  useEffect(() => {
    if (loaded || failed) return
    let live = true
    void load().then(() => { if (live) settled(n => n + 1) })
    return () => { live = false }
  }, [])
  return { pictureFor: loaded, ready: loaded != null || failed }
}
