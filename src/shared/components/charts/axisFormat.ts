// Y-axis tick text is right-anchored inside `YAxis width`, and the chart
// margins pull that box further left — with width={30} and left:-20 only ~10px
// were left, so 4–5 digit step/energy ticks rendered as clipped slivers of
// glyphs. Compacting thousands keeps the axis narrow enough to stay out of the
// plot area while every tick stays fully readable.
export function compactAxisTick(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return String(value)
  if (Math.abs(n) < 1000) return String(n)
  return `${+(n / 1000).toFixed(1)}k`
}
