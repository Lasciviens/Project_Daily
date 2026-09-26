import { useLayoutEffect, useRef } from 'react'

/**
 * Scrolls `el` back to the top when `key` changes (a new section, platform,
 * filter, sort or search) — never on mount and never for the same key, so a
 * status edit or a refetch leaves the scroll position alone. Before paint,
 * so the new list never flashes at the old list's offset.
 */
export function useScrollReset(el: HTMLElement | null, key: string | undefined) {
  const last = useRef(key)
  useLayoutEffect(() => {
    if (key === undefined || last.current === key) return
    last.current = key
    el?.scrollTo({ top: 0 })
  }, [el, key])
}
