import { useEffect, useRef, useState } from 'react'
import { useTrendingMovies, useTrendingTV } from '../hooks/useTMDB'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w1280'
const ROTATE_MS = 8000
const FADE_MS = 1500

export function MediaBackdrop() {
  const { data: movies } = useTrendingMovies('week')
  const { data: tv }     = useTrendingTV('week')

  const backdrops = [
    ...(movies ?? []).map(m => m.backdrop_path ?? m.poster_path),
    ...(tv    ?? []).map(t => t.backdrop_path ?? t.poster_path),
  ].filter((p): p is string => Boolean(p)).slice(0, 20)

  const [currentIdx, setCurrentIdx] = useState(0)
  const [nextIdx,    setNextIdx]    = useState<number | null>(null)
  // fading = true while the next image is transitioning in
  const [fading, setFading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (backdrops.length < 2) return

    timerRef.current = setInterval(() => {
      setNextIdx(prev => {
        const next = (((prev ?? currentIdx) + 1) % backdrops.length)
        return next
      })
      setFading(true)
    }, ROTATE_MS)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backdrops.length])

  // After fade completes, make next the current
  useEffect(() => {
    if (!fading || nextIdx === null) return
    const t = setTimeout(() => {
      setCurrentIdx(nextIdx)
      setNextIdx(null)
      setFading(false)
    }, FADE_MS)
    return () => clearTimeout(t)
  }, [fading, nextIdx])

  if (backdrops.length === 0) return null

  const currentSrc = `${TMDB_IMG}${backdrops[currentIdx]}`
  const nextSrc    = nextIdx !== null ? `${TMDB_IMG}${backdrops[nextIdx]}` : null

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      {/* Current image */}
      <img
        key={currentSrc}
        src={currentSrc}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover opacity-[0.06]"
        style={{ transition: `opacity ${FADE_MS}ms ease-in-out` }}
      />

      {/* Next image — fades in on top, then becomes current */}
      {nextSrc && (
        <img
          key={nextSrc}
          src={nextSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: fading ? 0.06 : 0,
            transition: fading ? `opacity ${FADE_MS}ms ease-in-out` : 'none',
          }}
        />
      )}
    </div>
  )
}
