/**
 * A thin bar for the Data health cards. With `track`, the whole width is the
 * total in a soft accent tint and the filled share sits over it in the accent
 * (filled of total); without, the bar alone is `value`'s share of `max`.
 * Decorative: the numbers always stand beside it.
 */
export function TgAnalyticsHealthMeter({ value, max, track = false }: { value: number; max: number; track?: boolean }) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <span
      aria-hidden
      className={`relative block h-2 w-full overflow-hidden rounded-full ${track ? 'bg-[color-mix(in_srgb,var(--tg-accent)_22%,var(--tg-panel))]' : ''}`}
    >
      {value > 0 && (
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--tg-accent)] transition-[filter] duration-150 [@media(hover:hover)]:group-hover:brightness-110"
          style={{ width: `max(3px, ${share * 100}%)` }}
        />
      )}
    </span>
  )
}
