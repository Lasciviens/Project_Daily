// A short button's description on touch (owner, 24.11.2026: "Button names should be short … If you need the description;
// show it when mouse is on it"). A mouse sees a control's `title`; a finger has no hover, so a finger RESTING on a control —
// a button, link, label, tab, chip or menu line — shows its words (the nearest `data-tip` or `title`, else its accessible
// name) in a small bubble above it, and that press does not tap it. A quick tap still taps; a text field is never touched. One listener for the whole app, installed in idle time after the
// first paint (main.tsx), so it costs the first download nothing; every `IconButton` and every `Button tip` is covered.
// Pure DOM, no React: scripts/verify-short-buttons.mjs checks the selector and the click guard.

/** A control a long press may explain: a button, a link, a label, a tab, a chip, a menu line. */
export const TIP_CONTROL = 'button, a, label, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], .chip'
/** Where the words are: the nearest `data-tip` or `title` at or around the press (inside the control, or the control itself). */
export const TIP_SOURCE = '[data-tip], [title]'
/** Never in a text field: a long press there selects, pastes or moves the caret (critic, 24.11.2026). */
export const TIP_NEVER = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
/** How long a finger rests before the description shows (longer than a tap, shorter than iOS's own press menu), and how long it stays. */
export const HOLD_MS = 575
const SHOW_MS = 2500

/**
 * The element whose words a long press shows, or null: the press must be on a control and not in a text field; the words are
 * the nearest `data-tip` / `title` inside that control (a tab's label span, an icon's button) or the control's own.
 */
export function tipTarget(target: Element | null): Element | null {
  if (!target || target.closest(TIP_NEVER)) return null
  const control = target.closest(TIP_CONTROL)
  if (!control) return null
  const source = target.closest(TIP_SOURCE)
  if (source && (control.contains(source) || source.contains(control))) return source
  return control.hasAttribute('aria-label') ? control : null
}

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
    const el = tipTarget(e.target instanceof Element ? e.target : null)
    const words = el ? tipOf(el) : null
    if (!el || !words || (el.closest('button') as HTMLButtonElement | null)?.disabled) return
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
  // A key (a hardware keyboard, Enter on the control) ends a held press: the next click is the keyboard's, never swallowed.
  const key = () => { held = null; stop(); hide() }
  doc.addEventListener('pointerdown', down, true)
  doc.addEventListener('pointerup', stop, true)
  doc.addEventListener('pointercancel', stop, true)
  doc.addEventListener('scroll', scrolled, true)
  doc.addEventListener('click', click, true)
  doc.addEventListener('contextmenu', menu, true)
  doc.addEventListener('keydown', key, true)
  return () => {
    stop(); hide()
    doc.removeEventListener('pointerdown', down, true)
    doc.removeEventListener('pointerup', stop, true)
    doc.removeEventListener('pointercancel', stop, true)
    doc.removeEventListener('scroll', scrolled, true)
    doc.removeEventListener('click', click, true)
    doc.removeEventListener('contextmenu', menu, true)
    doc.removeEventListener('keydown', key, true)
  }
}
