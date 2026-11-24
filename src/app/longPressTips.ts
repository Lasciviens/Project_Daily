// A short button's description on touch (owner, 24.11.2026: "Button names should be short … If you need the description;
// show it when mouse is on it"). A mouse sees a button's `title`; a finger has no hover, so a finger RESTING on a button
// (or a link or label with a `title`, or anything with `data-tip`) shows the same words in a small bubble above it, and
// that press does not tap it. A quick tap still taps. One listener for the whole app, installed in idle time after the
// first paint (main.tsx), so it costs the first download nothing; every `IconButton` and every `Button tip` is covered.
// Pure DOM, no React: scripts/verify-short-buttons.mjs checks the selector and the click guard.

/** What a long press explains: a control with a title, or anything marked with data-tip. */
export const TIP_TARGET = 'button[title], a[title], label[title], [role="button"][title], [data-tip]'
/** How long a finger rests before the description shows, and how long it stays. */
export const HOLD_MS = 450
const SHOW_MS = 2500

/** The words a long press shows for an element: its data-tip, else its title, else its accessible name. */
export function tipOf(el: Element): string | null {
  const t = el.getAttribute('data-tip') || el.getAttribute('title') || el.getAttribute('aria-label')
  return t && t.trim() ? t.trim() : null
}

export function installLongPressTips(doc: Document = document): () => void {
  let timer: number | null = null
  let held: Element | null = null
  let bubble: HTMLElement | null = null
  let hideTimer: number | null = null
  const hide = () => {
    bubble?.remove(); bubble = null
    if (hideTimer != null) { window.clearTimeout(hideTimer); hideTimer = null }
  }
  const stop = () => { if (timer != null) { window.clearTimeout(timer); timer = null } }
  const show = (el: Element, words: string) => {
    hide()
    const r = el.getBoundingClientRect()
    const b = doc.createElement('span')
    b.setAttribute('role', 'tooltip')
    b.textContent = words
    // Above the control, or below it at the top of the screen; never past the screen's sides.
    b.className = 'long-press-tip'
    const below = r.top < 56
    b.style.top = `${below ? r.bottom + 8 : r.top - 8}px`
    b.style.left = `${Math.min(Math.max(r.left + r.width / 2, 96), window.innerWidth - 96)}px`
    if (!below) b.style.transform = 'translate(-50%, -100%)'
    doc.body.appendChild(b)
    bubble = b
    hideTimer = window.setTimeout(hide, SHOW_MS)
  }
  const down = (e: PointerEvent) => {
    hide()
    held = null
    if (e.pointerType === 'mouse') return
    const el = (e.target as Element | null)?.closest?.(TIP_TARGET)
    const words = el ? tipOf(el) : null
    if (!el || !words || (el as HTMLButtonElement).disabled) return
    stop()
    timer = window.setTimeout(() => { timer = null; held = el; show(el, words) }, HOLD_MS)
  }
  // A press that showed the description is not a tap (capture: before the control's own handler).
  const click = (e: MouseEvent) => {
    if (held && e.target instanceof Node && held.contains(e.target)) { e.preventDefault(); e.stopPropagation() }
    held = null
  }
  const menu = (e: Event) => { if (held || timer != null) e.preventDefault() }
  const scrolled = () => { stop(); hide() }
  doc.addEventListener('pointerdown', down, true)
  doc.addEventListener('pointerup', stop, true)
  doc.addEventListener('pointercancel', stop, true)
  doc.addEventListener('scroll', scrolled, true)
  doc.addEventListener('click', click, true)
  doc.addEventListener('contextmenu', menu, true)
  return () => {
    stop(); hide()
    doc.removeEventListener('pointerdown', down, true)
    doc.removeEventListener('pointerup', stop, true)
    doc.removeEventListener('pointercancel', stop, true)
    doc.removeEventListener('scroll', scrolled, true)
    doc.removeEventListener('click', click, true)
    doc.removeEventListener('contextmenu', menu, true)
  }
}
