import { ArrowRight, HardDrive } from 'lucide-react'
import { formatBytes, formatDelta, type StorageChange, type StorageNow } from './tgScrapeModel'

const tone = (d: number) => (Math.abs(d) < 1024 ? 'var(--tg-text-2)' : d < 0 ? 'var(--tg-green)' : 'var(--tg-text)')

/**
 * The review's storage banner: this game now → after this save, the
 * ScreenScraper part on its own, and one plain line per thing the save adds
 * or removes. Copies are estimated before download.
 */
export function TgScrapeStorageBanner({ now, change, copyLabels, online }: {
  now: StorageNow | null; change: StorageChange; copyLabels: string[]; online: number
}) {
  const lines: { sign: '+' | '−' | '·'; text: string }[] = []
  if (change.addCopies) lines.push({ sign: '+', text: `Adds ${copyLabels.length === 1 ? 'a copy' : `${copyLabels.length} copies`} of ${copyLabels.join(', ')} — about ${formatBytes(change.addCopies)}` })
  if (change.removeCopies) lines.push({ sign: '−', text: `Removes the ${change.removeFiles} earlier ScreenScraper cop${change.removeFiles === 1 ? 'y' : 'ies'} — ${formatBytes(change.removeCopies)} freed` })
  lines.push(change.recordBefore
    ? { sign: '·', text: `Replaces ScreenScraper's text record (about ${formatBytes(change.recordAfter)})` }
    : { sign: '+', text: `Saves ScreenScraper's text record — about ${formatBytes(change.recordAfter)}` })
  if (online) lines.push({ sign: '·', text: `${online} picture${online === 1 ? ' stays' : 's stay'} online — no storage used` })
  if (now?.handheldBytes) lines.push({ sign: '·', text: `Your handheld's pictures (${formatBytes(now.handheldBytes)}) are not touched` })

  return (
    <section className="tg-panel flex flex-col gap-3 p-4" aria-label="Storage for this game">
      <h3 className="tg-section-label flex items-center gap-1.5"><HardDrive className="h-3.5 w-3.5" aria-hidden /> Storage for this game</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label="This game" before={now ? change.before : null} after={change.after} delta={change.delta} />
        <Figure label="ScreenScraper part" before={now ? change.ssBefore : null} after={change.ssAfter} delta={change.ssAfter - change.ssBefore} />
        <div className="col-span-2 flex flex-col justify-center sm:col-span-1">
          <span className="text-[11.5px] tg-muted">This save</span>
          <strong className="text-[20px] leading-tight tabular-nums" style={{ color: tone(change.delta) }}>{formatDelta(change.delta)}</strong>
        </div>
      </div>
      <ul className="flex flex-col gap-1 text-[12.5px] leading-snug">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="w-3 shrink-0 text-center font-bold" style={{ color: l.sign === '+' ? 'var(--tg-text)' : l.sign === '−' ? 'var(--tg-green)' : 'var(--tg-muted)' }}>{l.sign}</span>
            <span className={l.sign === '·' ? 'tg-muted' : ''}>{l.text}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] tg-muted">Sizes of new copies are estimates until they are downloaded.</p>
    </section>
  )
}

function Figure({ label, before, after, delta }: { label: string; before: number | null; after: number; delta: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11.5px] tg-muted">{label}</span>
      <span className="flex flex-wrap items-center gap-1 text-[14px] tabular-nums">
        {before != null && <><span>{before > 0 ? formatBytes(before) : 'none'}</span><ArrowRight className="h-3.5 w-3.5 tg-muted" aria-label="after saving" /></>}
        <strong>≈ {formatBytes(after)}</strong>
      </span>
      {before != null && <span className="text-[11.5px] tabular-nums" style={{ color: tone(delta) }}>{formatDelta(delta)}</span>}
    </div>
  )
}

/** One line for the sticky Save bar. */
export function TgScrapeStorageLine({ now, change }: { now: StorageNow | null; change: StorageChange }) {
  return (
    <p className="flex items-center gap-1.5 text-[12px] tabular-nums text-[var(--tg-text-2)]">
      <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {now
        ? <span>Storage {formatBytes(change.before)} → ≈ {formatBytes(change.after)} <strong style={{ color: tone(change.delta) }}>({formatDelta(change.delta)})</strong></span>
        : <span>This save adds ≈ {formatBytes(change.after)}</span>}
    </p>
  )
}
