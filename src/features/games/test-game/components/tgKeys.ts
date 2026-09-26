// Keyboard-shortcut guards shared by the page's single-key shortcuts
// ("/" and ⌘K for search, "r" for a random game).

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
}

const DIALOG = '[role="dialog"], [role="alertdialog"]'

/**
 * A dialog (edit form, detail drawer, lightbox, phone sheet) owns the keyboard
 * while it is open: a shortcut must not act on the library behind it.
 */
export function dialogIsOpen(t: EventTarget | null): boolean {
  if (t instanceof Element && t.closest(DIALOG)) return true
  return document.querySelector(DIALOG) != null
}
