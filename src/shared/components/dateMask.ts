// The typing rules of the DD.MM.YYYY field (DateInput). Pure, no React.
//
// The field always holds eight digit slots, shown as __.__.____. A key writes
// or clears ONE slot and never moves the others: deleting the 9 of 10.09.2026
// leaves 10.0_.2026 (the old field squeezed the digits together into
// 10.02.026). Positions are caret positions in the shown text, 0–10.
// Checked by scripts/verify-date-mask.cjs.

export const EMPTY_SLOTS = '________'
export const END = 10
/** Where each slot sits in the shown text. */
const POS = [0, 1, 3, 4, 6, 7, 8, 9]
const SEPARATORS = './-, '

export interface MaskState { slots: string; caret: number }

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const put = (slots: string, i: number, c: string) => slots.slice(0, i) + c + slots.slice(i + 1)
const pad2 = (n: number) => String(n).padStart(2, '0')

export const isSeparator = (c: string) => c.length === 1 && SEPARATORS.includes(c)
export const isEmptySlots = (slots: string) => slots === EMPTY_SLOTS

export function slotsToText(slots: string): string {
  return `${slots.slice(0, 2)}.${slots.slice(2, 4)}.${slots.slice(4)}`
}

export function isoToSlots(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return m ? m[3] + m[2] + m[1] : EMPTY_SLOTS
}

/** First slot at or after a caret position, -1 past the end. */
function slotAtOrAfter(pos: number): number {
  return POS.findIndex(p => p >= pos)
}
function slotBefore(pos: number): number {
  for (let i = POS.length - 1; i >= 0; i--) if (POS[i] < pos) return i
  return -1
}
/** The caret after writing slot i: the next slot, skipping the dot. */
const caretAfter = (i: number) => (i + 1 < POS.length ? POS[i + 1] : END)

function clearRange(slots: string, from: number, to: number): string {
  let out = slots
  POS.forEach((p, i) => { if (p >= from && p < to) out = put(out, i, '_') })
  return out
}

/**
 * A digit typed with the selection start..end (equal = a caret). It
 * overwrites the slot at the caret; a day starting 4–9 or a month starting
 * 2–9 can only be 0d/0m, so it becomes that and the caret moves on.
 */
export function typeDigit(slots: string, start: number, end: number, digit: string): MaskState {
  const s0 = start !== end ? clearRange(slots, start, end) : slots
  let i = start === end && isEmptySlots(s0) ? 0 : slotAtOrAfter(start)
  if (i < 0) i = s0.indexOf('_')
  if (i < 0) return { slots: s0, caret: END }
  const n = Number(digit)
  if ((i === 0 && n > 3) || (i === 2 && n > 1)) {
    return { slots: put(put(s0, i, '0'), i + 1, digit), caret: caretAfter(i + 1) }
  }
  return { slots: put(s0, i, digit), caret: caretAfter(i) }
}

/**
 * A separator (. / - , or space) closes the day or month the caret is in:
 * one digit becomes 0d, and the caret goes to the next part. Right after a
 * finished part (caret at the start of an empty one) it does nothing, so
 * "12.05" types the same as "1205".
 */
export function typeSeparator(slots: string, _start: number, end: number): MaskState {
  const caret = end
  const part = caret <= 2 ? 0 : caret <= 5 ? 1 : 2
  if (part === 2) return { slots, caret }
  const a = part * 2
  const first = slots[a]
  const second = slots[a + 1]
  if (!isDigit(first) && !isDigit(second)) return { slots, caret }
  const s = isDigit(first) && second === '_' ? put(put(slots, a, '0'), a + 1, first) : slots
  return { slots: s, caret: POS[a + 2] }
}

/** Backspace clears the digit before the caret (or the selection). */
export function backspace(slots: string, start: number, end: number): MaskState {
  if (start !== end) return { slots: clearRange(slots, start, end), caret: start }
  const i = slotBefore(start)
  if (i < 0) return { slots, caret: start }
  return { slots: put(slots, i, '_'), caret: POS[i] }
}

/** Delete clears the digit after the caret (or the selection). */
export function deleteForward(slots: string, start: number, end: number): MaskState {
  if (start !== end) return { slots: clearRange(slots, start, end), caret: start }
  const i = slotAtOrAfter(start)
  if (i < 0) return { slots, caret: start }
  return { slots: put(slots, i, '_'), caret: POS[i] + 1 }
}

/** Text typed one character at a time (digits and separators; the rest is ignored). */
export function typeText(slots: string, start: number, end: number, text: string): MaskState {
  let state: MaskState = { slots, caret: end }
  let a = start
  let b = end
  for (const c of text) {
    if (isDigit(c)) state = typeDigit(state.slots, a, b, c)
    else if (isSeparator(c)) state = typeSeparator(state.slots, a, b)
    else continue
    a = b = state.caret
  }
  return state
}

/** Pasted text: a whole date in any accepted form replaces the field; anything else is typed in. */
export function pasteText(slots: string, start: number, end: number, text: string): MaskState {
  const iso = parseLooseDate(text)
  if (iso) return { slots: isoToSlots(iso), caret: END }
  return typeText(slots, start, end, text)
}

/** The field's text changed by some other way (undo, autofill, drag and drop). */
export function slotsFromText(text: string): string {
  if (text.length === 10 && text[2] === '.' && text[5] === '.' && POS.every(p => isDigit(text[p]) || text[p] === '_')) {
    return POS.map(p => text[p]).join('')
  }
  const iso = parseLooseDate(text)
  return iso ? isoToSlots(iso) : typeText(EMPTY_SLOTS, 0, 0, text).slots
}

/** On leaving the field: a two-digit year means 20yy, a one-digit day or month gets its 0. */
export function completeSlots(slots: string): string {
  let s = slots
  if (isDigit(s[4]) && isDigit(s[5]) && s[6] === '_' && s[7] === '_') s = `${s.slice(0, 4)}20${s.slice(4, 6)}`
  for (const a of [0, 2]) {
    const c = s[a]
    if (isDigit(c) && s[a + 1] === '_') s = put(put(s, a, '0'), a + 1, c)
  }
  return s
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(m) ? 30 : 31
}

function isoIfReal(y: number, m: number, d: number): string | null {
  const ok = Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
  return ok ? `${y}-${pad2(m)}-${pad2(d)}` : null
}

/**
 * A date written in any of the accepted ways, as yyyy-MM-dd: 07122026,
 * 071226, 7.12.2026, 07.12.26, 7-12-2026, 7/12/26, 7 12 2026, 2026-12-07,
 * 20261207. A two-digit year means 20yy. Null when it is no real day.
 */
export function parseLooseDate(text: string): string | null {
  const t = text.trim().replace(/\.$/, '')
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return isoIfReal(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})\s*[./\-, ]\s*(\d{1,2})\s*[./\-, ]\s*(\d{2}|\d{4})$/.exec(t)
  if (m) return isoIfReal(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  if (/^\d{8}$/.test(t)) {
    return isoIfReal(+t.slice(4), +t.slice(2, 4), +t.slice(0, 2)) ?? isoIfReal(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6))
  }
  if (/^\d{6}$/.test(t)) return isoIfReal(2000 + +t.slice(4), +t.slice(2, 4), +t.slice(0, 2))
  return null
}

export type SlotsCheck =
  | { state: 'empty' }
  | { state: 'partial' }
  | { state: 'bad' }
  | { state: 'out'; iso: string }
  | { state: 'ok'; iso: string }

/**
 * What the slots hold. A finished day or month that can't exist is 'bad'
 * before the rest is typed (35.__.____, 31.04.____); 29.02 waits for the year.
 */
export function checkSlots(slots: string, min?: string, max?: string): SlotsCheck {
  if (!/\d/.test(slots)) return { state: 'empty' }
  const num = (a: number, b: number) => (/^\d+$/.test(slots.slice(a, b)) ? Number(slots.slice(a, b)) : null)
  const d = num(0, 2)
  const m = num(2, 4)
  const y = num(4, 8)
  if (d !== null && (d < 1 || d > 31)) return { state: 'bad' }
  if (m !== null && (m < 1 || m > 12)) return { state: 'bad' }
  if (d !== null && m !== null && d > daysInMonth(y ?? 2000, m)) return { state: 'bad' }
  if (d === null || m === null || y === null) return { state: 'partial' }
  const iso = isoIfReal(y, m, d)
  if (!iso) return { state: 'bad' }
  if ((min && iso < min) || (max && iso > max)) return { state: 'out', iso }
  return { state: 'ok', iso }
}
