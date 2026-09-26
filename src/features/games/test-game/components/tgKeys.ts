// Keyboard-shortcut guards shared by the page's single-key shortcuts
// ("/" and ⌘K for search, "r" for a random game).

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
}

const DIALOG = '[role="dialog"], [role="alertdialog"]'
// An open listbox or menu (Sort, the filter checklists, ⋯) uses letters for
// type-ahead: "r" there jumps to "Recently added", it must not open a game.
const POPUP = '[role="listbox"], [role="menu"]'

/**
 * A dialog (edit form, detail drawer, lightbox, phone sheet) or an open list
 * owns the keyboard: a shortcut must not act on the library behind it.
 */
export function dialogIsOpen(t: EventTarget | null): boolean {
  if (t instanceof Element && t.closest(`${DIALOG}, ${POPUP}, [role="option"], [role="menuitem"]`)) return true
  return document.querySelector(`${DIALOG}, ${POPUP}`) != null
}
