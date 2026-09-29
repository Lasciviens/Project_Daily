// DOM helpers for LinkedTextEditor: the value <-> contenteditable mapping
// (a link is `[[@id]]` in the value, one atomic <span data-ref> on screen).
import { REF_RE, refToken } from '../devRequestMarks'

export const REF_ATTR = 'data-ref'
/** The <br> that lets a trailing newline show; not part of the value. */
const END_ATTR = 'data-end'

/** The last caret position (in value characters) each editor had. */
export const lastCaret = new WeakMap<HTMLElement, number>()

export function serialize(node: Node): string {
  let out = ''
  node.childNodes.forEach(n => {
    if (n.nodeType === Node.TEXT_NODE) { out += n.textContent ?? ''; return }
    if (!(n instanceof HTMLElement)) return
    const ref = n.getAttribute(REF_ATTR)
    if (ref) { out += refToken(ref); return }
    if (n.tagName === 'BR') return
    if ((n.tagName === 'DIV' || n.tagName === 'P') && out && !out.endsWith('\n')) out += '\n'
    out += serialize(n)
  })
  return out
}

/** A DOM position inside `root` as a value offset. */
function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange()
  r.selectNodeContents(root)
  try { r.setEnd(node, offset) } catch { return serialize(root).length }
  const box = document.createElement('div')
  box.appendChild(r.cloneContents())
  return serialize(box).length
}

export function selectionOffsets(root: HTMLElement): [number, number] | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const r = sel.getRangeAt(0)
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null
  return [offsetOf(root, r.startContainer, r.startOffset), offsetOf(root, r.endContainer, r.endOffset)]
}

/** Where a new link goes: the caret, else where it last was, else the end. */
export function caretOffsetIn(root: HTMLElement | null): number | null {
  if (!root) return null
  return selectionOffsets(root)?.[0] ?? lastCaret.get(root) ?? null
}

/** Puts the caret at a value offset and focuses the editor. */
export function focusAtOffset(root: HTMLElement | null, offset: number) {
  if (!root) return
  const r = document.createRange()
  let acc = 0
  let placed = false
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = n.textContent?.length ?? 0
      if (offset <= acc + len) { r.setStart(n, offset - acc); placed = true; break }
      acc += len
    } else if (n instanceof HTMLElement && n.getAttribute(REF_ATTR)) {
      const len = refToken(n.getAttribute(REF_ATTR)!).length
      if (offset <= acc) { r.setStartBefore(n); placed = true; break }
      if (offset <= acc + len) { r.setStartAfter(n); placed = true; break }
      acc += len
    }
  }
  if (!placed) {
    const end = root.querySelector(`[${END_ATTR}]`)
    if (end) r.setStartBefore(end)
    else { r.selectNodeContents(root); r.collapse(false) }
  }
  r.collapse(true)
  root.focus({ preventScroll: true })
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(r)
  lastCaret.set(root, offset)
}

export function render(root: HTMLElement, value: string, labelOf: (id: string) => string) {
  root.replaceChildren()
  let last = 0
  const text = (t: string) => { if (t) root.appendChild(document.createTextNode(t)) }
  for (const m of value.matchAll(REF_RE)) {
    const i = m.index ?? 0
    text(value.slice(last, i))
    const link = document.createElement('span')
    link.setAttribute(REF_ATTR, m[1])
    link.contentEditable = 'false'
    link.title = 'Open the page and show this spot'
    link.className = 'cursor-pointer rounded-sm font-medium text-accent-600 underline decoration-accent-500/60 underline-offset-2 hover:decoration-accent-600'
    link.textContent = labelOf(m[1])
    root.appendChild(link)
    last = i + m[0].length
  }
  text(value.slice(last))
  if (value.endsWith('\n')) {
    const br = document.createElement('br')
    br.setAttribute(END_ATTR, '')
    root.appendChild(br)
  }
}

