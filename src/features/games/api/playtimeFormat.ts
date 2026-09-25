// Playtime, in units a human actually reasons in.
//
// "1542 hours total" is a true number that tells you nothing — nobody holds
// four digits of hours as a quantity. The same span as "64d 6h" is instantly
// legible. This is the ONE formatter for every playtime figure on the Games
// page; there were four near-identical local copies before (PlayStationTab,
// PsnGameModal, SteamGameModal, SteamTab), two of which had drifted into a
// Turkish "s" suffix inside English UI strings.
//
// Import-free on purpose (the `exerciseGifResolver.ts` precedent) so the
// arithmetic is requirable from a sucrase verify script.

/**
 * Days / hours / minutes, largest unit first, **skipping any unit that is
 * zero**. Exactly 1542 hours renders "64d 6h", not "64d 6h 0m" — a zero is
 * noise, not precision — while a real remainder is kept at every scale
 * ("9d 12h 56m"), so no figure silently loses resolution.
 *
 * Sub-minute values round to whole minutes and read "0m" rather than
 * disappearing: a game launched once for forty seconds is still a real,
 * different fact from one never launched, which callers render as "—".
 */
export function formatPlaytime(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—'
  const total = Math.max(0, Math.round(minutes))

  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60

  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)

  return parts.length ? parts.join(' ') : '0m'
}
