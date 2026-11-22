// The toast words of a batch add. Its own tiny file: the screens that only show the words (Projects, Food) must not
// pull Shop's title rules into their page chunk (verify-bundle-budget).

/** "Added 5 items to the quick list · Week 48 · 2 already there" (the toast's words before Undo). */
export function batchWords(added: number, skipped: number, what: string): string {
  const parts = [`Added ${added} ${added === 1 ? 'item' : 'items'} to the quick list${what ? ` · ${what}` : ''}`]
  if (skipped > 0) parts.push(`${skipped} already there`)
  return parts.join(' · ')
}
