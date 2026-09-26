// en-GB short dates, THEME.md §3: "15 Sep 2026". CLDR's en-GB data renders
// September's short name as "Sept"; every other month is already three
// letters, so the one fix-up is Sept → Sep. Route every `month: 'short'`
// through here instead of calling toLocale*String directly.

type DateLike = Date | string | number

const toDate = (d: DateLike) => (d instanceof Date ? d : new Date(d))
const fixSept = (s: string) => s.replace(/\bSept\b/g, 'Sep')

/** `toLocaleDateString('en-GB', opts)` with THEME §3's three-letter months. */
export function fmtDateEnGB(d: DateLike, opts: Intl.DateTimeFormatOptions): string {
  return fixSept(toDate(d).toLocaleDateString('en-GB', opts))
}

/** `toLocaleString('en-GB', opts)` (date + time) with three-letter months. */
export function fmtDateTimeEnGB(d: DateLike, opts: Intl.DateTimeFormatOptions): string {
  return fixSept(toDate(d).toLocaleString('en-GB', opts))
}

/** A short month name alone ("Sep"). */
export function fmtMonthShort(d: DateLike): string {
  return fixSept(toDate(d).toLocaleDateString('en-GB', { month: 'short' }))
}
