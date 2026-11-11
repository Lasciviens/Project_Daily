// A fact on one line, for text the owner copies out of the app — the ad (resaleTexts) and the complaint letter
// (complaintModel). Pure — scripts/verify-shop-resale.cjs and verify-shop-owning.cjs.
//
// A title, a store or an accessory's name can come from a web page or from the assistant, so it is input: a line
// break or a control character in it would start lines of its own in the ad or the letter, and a bidi control
// (U+202A–U+202E, U+2066–U+2069, U+200E/U+200F) would make what is pasted read differently from what was shown
// (security review, 11.11.2026). A control character becomes a space, a bidi control goes, spaces are squeezed.
// The zero-width joiner (U+200D) stays: emoji are built with it.

const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g
const CONTROL = /\p{Cc}+/gu

/** One line of text: no line breaks, control characters or bidi controls, spaces squeezed. */
export function oneLine(s: string | null | undefined): string {
  return (s ?? '').replace(BIDI, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
}
