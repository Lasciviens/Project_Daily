import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import { rememberLayout, rememberedLayout } from '../hooks/useLayoutMemory'
import { cx } from './cx'

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

/** The first of `keys` remembered as a size, in rem. */
function rememberedRoom(keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = rememberedLayout(k)
    if (typeof v === 'number') return v
  }
  return undefined
}

/**
 * A part whose data comes in on its own (THEME.md §5 "Nothing moves when data lands"). While `loading` it keeps
 * the room its content took when it last loaded on this device — none when it was empty — so the parts under it
 * stay where they were drawn when it lands; it never holds the content back. Once loaded it measures itself for
 * the next visit. With nothing remembered (the first visit), `first`: a size in rem, 'none' (a part that only
 * some data shows: reserve nothing), or by default the skeleton's own height.
 *
 * `skeleton` is shown while loading, else the children are, in the kept room (DayAgenda's rows while Google's
 * events still load). `ids`: the first remembered one is used, every one is written (DayAgenda: the day, then the
 * last today). `as="span"` inside phrasing content (a tile that is a `<button>`).
 */
export function KeepRoom({ ids, loading, skeleton, first, remember = true, as = 'div', className, children }: {
  ids: string | readonly string[]
  loading: boolean
  skeleton?: ReactNode
  first?: number | 'none'
  /** False: an outcome not to plan the next visit by (a failed read). */
  remember?: boolean
  as?: 'div' | 'span'
  className?: string
  children?: ReactNode
}) {
  const ref = useRef<HTMLElement | null>(null)
  const setRef = useCallback((el: HTMLElement | null) => { ref.current = el }, [])
  const keys = typeof ids === 'string' ? [ids] : ids
  useLayoutEffect(() => {
    if (loading || !remember) return
    const h = ref.current ? Math.round((ref.current.offsetHeight / remPx()) * 100) / 100 : 0
    for (const k of keys) rememberLayout(k, h)
  })

  const showSkeleton = loading && skeleton !== undefined
  const body = showSkeleton ? skeleton : children
  if (body == null || body === false) return null
  let room: number | undefined
  if (loading) {
    const last = rememberedRoom(keys)
    // Only a loading copy is left out — content that is already here always shows.
    if (showSkeleton && (last === 0 || (last === undefined && first === 'none'))) return null
    room = last ?? (typeof first === 'number' ? first : undefined)
  }
  // `empty:hidden`: a child that renders nothing leaves no gap in its stack.
  const props = { ref: setRef, className: cx('empty:hidden', className), style: room ? { minHeight: `${room}rem` } : undefined }
  return as === 'span' ? <span {...props}>{body}</span> : <div {...props}>{body}</div>
}
