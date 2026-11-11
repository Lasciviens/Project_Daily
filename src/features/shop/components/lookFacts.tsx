/** A fact longer than this may wrap inside itself: "from Ask AI — check it: Elkjøp's 30-day price protection" ran past the line. */
const LONG_FACT = 28

/**
 * Needs a look's facts for a `MetaLine` (each item keeps together): short ones stay whole ("in 25 days"), a long one
 * wraps inside itself instead of running under the row's action or out of the record's nudge (cleanup, 11.11.2026).
 */
export const wrapLong = (facts: readonly string[]) =>
  facts.map((f, i) => (f.length > LONG_FACT ? <span key={i} className="whitespace-normal break-words">{f}</span> : f))
