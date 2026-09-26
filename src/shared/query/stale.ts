/** Standard staleTime steps — pick one, never a bespoke number. */
export const STALE = {
  live: 30_000,          // clocks, departures
  short: 60_000,         // lists the user is actively editing
  default: 5 * 60_000,   // most reads
  long: 10 * 60_000,     // synced libraries, histories
  hour: 60 * 60_000,     // rate-limited external APIs (currency, weather)
  day: 24 * 60 * 60_000,
  never: Infinity,
} as const
