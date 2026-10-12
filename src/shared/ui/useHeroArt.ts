import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { heroArtPlace, type HeroArtPlace, type Span } from './heroArtRules'

/** The art needs this much free width beside the controls to show its subject. */
const FREE_REM = 12
/** Air between the art and a control on either side. */
const GAP_PX = 12

/**
 * Places a host's header art (THEME.md §6.5): measures the controls and texts
 * in `contentRef` against the art layer (`layerRef`, passed to PageHeroArt —
 * it covers the host exactly) and returns where the art goes (`place`) or
 * that it sits behind them (`behind`). Re-measured before paint on every
 * render, and whenever the host or the content changes size or the font
 * arrives.
 */
export function useHeroArt<C extends HTMLElement = HTMLDivElement>() {
  const layerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<C>(null)
  const [state, setState] = useState<{ place?: HeroArtPlace; behind: boolean }>({ behind: false })
  const stateRef = useRef(state)

  const measure = useCallback(() => {
    const host = layerRef.current, content = contentRef.current
    if (!host || !content) return
    const r = host.getBoundingClientRect()
    if (r.width === 0) return
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const found = heroArtPlace([r.left, r.right], occupiedSpans(content), FREE_REM * rem, GAP_PX)
    const place = found ? { left: Math.round(found.left), right: Math.round(found.right) } : undefined
    const prev = stateRef.current
    if (prev.behind !== !place || prev.place?.left !== place?.left || prev.place?.right !== place?.right) {
      stateRef.current = { place, behind: !place }
      setState(stateRef.current)
    }
  }, [])

  useLayoutEffect(() => { measure() })
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (layerRef.current) ro.observe(layerRef.current)
    if (contentRef.current) ro.observe(contentRef.current)
    void document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [measure])

  return { layerRef, contentRef, place: state.place, behind: state.behind }
}

/** Boxes that take their whole width: controls, pictures, painted panels. */
const SOLID = 'button, a, input, select, textarea, svg, img, [role="tab"], .seg, .card, [class*="bg-"]'

/** The horizontal stretches the content's controls and texts take (text by its glyphs, not its box). */
function occupiedSpans(content: HTMLElement): Span[] {
  const spans: Span[] = []
  const add = (r: DOMRect) => { if (r.width > 1 && r.height > 1) spans.push([r.left, r.right]) }
  const textSpan = (node: Node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    add(range.getBoundingClientRect())
  }
  const visit = (el: Element) => {
    if (el.classList.contains('sr-only')) return
    if (el.matches(SOLID)) { add(el.getBoundingClientRect()); return }
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) textSpan(node)
    }
    if (el.children.length === 0 && !el.textContent?.trim()) add(el.getBoundingClientRect())
    for (const child of el.children) visit(child)
  }
  visit(content)
  return spans
}
