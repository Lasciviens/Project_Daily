// The toast words of a batch add. Its own tiny file: the screens that only show the words (Projects, Food) must not
// pull Shop's title rules into their page chunk (verify-bundle-budget).

/** "Added 5 items to the quick list · Week 48 · 2 already there" (the toast's words before Undo). */
export function batchWords(added: number, skipped: number, what: string, skippedTitles: readonly string[] = []): string {
  const parts = [`Added ${added} ${added === 1 ? 'item' : 'items'} to the quick list${what ? ` · ${what}` : ''}`]
  // Named (three at most, "…" for more) when the caller knows which ones: "2 already there: Milk, Bread".
  if (skipped > 0) parts.push(`${skipped} already there${skippedTitles.length ? `: ${skippedTitles.slice(0, 3).join(', ')}${skippedTitles.length > 3 ? '…' : ''}` : ''}`)
  return parts.join(' · ')
}
