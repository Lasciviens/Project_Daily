import { useEffect, useRef, useState } from 'react'
import type { RecipeWithIngredients } from '../types'

const ROTATE_MS = 30000
const FADE_MS   = 1500

/**
 * Header backdrop for RecipesPage — mirrors MediaBackdrop's rotating-image
 * treatment, but sourced from the user's own recipe cover images instead of
 * an external feed (falls back to a single static food photo, Training-style,
 * until at least one recipe has an image).
 */
export function RecipeBackdrop({ recipes }: { recipes: RecipeWithIngredients[] }) {
  const images = [...new Set(recipes.map(r => r.image_url).filter((u): u is string => !!u))].slice(0, 12)

  const [currentIdx, setCurrentIdx] = useState(0)
  const [nextIdx,    setNextIdx]    = useState<number | null>(null)
  const [fading,     setFading]     = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (images.length < 2) return
    timerRef.current = setInterval(() => {
      setNextIdx(prev => ((prev ?? currentIdx) + 1) % images.length)
      setFading(true)
    }, ROTATE_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length])

  useEffect(() => {
    if (!fading || nextIdx === null) return
    const t = setTimeout(() => { setCurrentIdx(nextIdx); setNextIdx(null); setFading(false) }, FADE_MS)
    return () => clearTimeout(t)
  }, [fading, nextIdx])

  // No recipe photos yet — a warm food-toned gradient + oversized decorative
  // emoji instead of hotlinking an external stock photo we can't verify.
  if (images.length === 0) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-orange-100 via-cream-100 to-accent-100" aria-hidden>
        <span className="absolute -right-4 -bottom-6 text-[7rem] opacity-25 select-none rotate-[-8deg]">🍲</span>
      </div>
    )
  }

  const currentSrc = images[currentIdx]
  const nextSrc     = nextIdx !== null ? images[nextIdx] : null

  return (
    <div className="absolute inset-0 overflow-hidden">
      <img key={currentSrc} src={currentSrc} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-20" />
      {nextSrc && (
        <img
          key={nextSrc} src={nextSrc} alt="" aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: fading ? 0.2 : 0, transition: fading ? `opacity ${FADE_MS}ms ease-in-out` : 'none' }}
        />
      )}
    </div>
  )
}
