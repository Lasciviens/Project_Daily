import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { SsCandidate, SsLocalized, SsRomInfo } from '../../../scraper/ssTypes'
import { fetchCandidate } from '../../../scraper/ssApi'
import { formatBytes } from './tgScrapeModel'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-1.5 text-[12.5px]">
      <dt className="tg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-[var(--tg-text)]">{children}</dd>
    </div>
  )
}

function Keyed({ list }: { list: SsLocalized[] }) {
  return (
    <span className="flex flex-col gap-0.5">
      {list.map((e, i) => (
        <span key={`${e.key}-${i}`}><span className="mr-1.5 inline-block min-w-[2.2rem] rounded bg-[var(--tg-panel-2)] px-1 text-center text-[10.5px] font-semibold uppercase tg-muted">{e.key || '—'}</span>{e.text}</span>
      ))}
    </span>
  )
}

const romLine = (r: SsRomInfo) => [r.filename, formatBytes(r.size), r.regions.join('/').toUpperCase() || null, r.flags.join(', ') || null].filter(Boolean).join(' · ')

/**
 * Everything else ScreenScraper knows about the entry — every regional title
 * and date, every rating board, the series, themes and styles, the matched
 * dump and its hashes, every known dump — and, on request, their whole answer
 * as they sent it (every URL removed).
 */
export function TgScrapeRecord({ candidate: c, storedRaw }: {
  candidate: SsCandidate
  /** The record as saved with the game — shown without asking ScreenScraper again. */
  storedRaw?: unknown
}) {
  const [raw, setRaw] = useState<unknown>(null)
  const [rawState, setRawState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [synopsesOpen, setSynopsesOpen] = useState(false)

  const loadRaw = async () => {
    if (raw) { setRaw(null); return }
    if (storedRaw) { setRaw(storedRaw); return }
    setRawState('loading')
    try {
      const r = await fetchCandidate(c.jeu_id, c.matched_by)
      if (r.status !== 'ok' || !r.record) throw new Error(r.error ?? 'No record')
      setRaw(r.record)
      setRawState('idle')
    } catch {
      setRawState('error')
    }
  }

  const lists: [string, string[]][] = [
    ['Genres', c.genres], ['Modes', c.modes], ['Series', c.families], ['Number', c.numbers], ['Themes', c.themes], ['Styles', c.styles],
  ]
  return (
    <div className="flex flex-col gap-1">
      <dl className="divide-y divide-[var(--tg-border)]">
        <Row label="ScreenScraper id">#{c.jeu_id}{c.rom_id ? ` · ROM #${c.rom_id}` : ''}{c.clone_of ? ` · clone of #${c.clone_of}` : ''}</Row>
        {c.note20 != null && <Row label="Their score">{c.note20} / 20{c.top_staff ? ' · staff pick' : ''}</Row>}
        {c.names.length > 0 && <Row label={`Titles (${c.names.length})`}><Keyed list={c.names} /></Row>}
        {c.dates.length > 0 && <Row label={`Released (${c.dates.length})`}><Keyed list={c.dates} /></Row>}
        {c.classifications.length > 0 && <Row label="Age ratings"><Keyed list={c.classifications} /></Row>}
        {lists.filter(([, v]) => v.length).map(([k, v]) => <Row key={k} label={k}>{v.join(', ')}</Row>)}
        {c.rotation && <Row label="Screen rotation">{c.rotation}°</Row>}
        {c.resolution && <Row label="Resolution">{c.resolution}</Row>}
        {c.synopses.length > 0 && (
          <Row label={`Descriptions (${c.synopses.length})`}>
            <button type="button" onClick={() => setSynopsesOpen(o => !o)} className="font-semibold text-[var(--tg-accent)]">
              {synopsesOpen ? 'Hide' : `Show all (${c.synopses.map(s => s.key.toUpperCase()).join(', ')})`}
            </button>
            {synopsesOpen && <span className="mt-1.5 block whitespace-pre-line"><Keyed list={c.synopses} /></span>}
          </Row>
        )}
        {c.rom && (
          <Row label="Matched ROM">
            <span className="block">{romLine(c.rom)}</span>
            <span className="mt-0.5 block font-mono text-[11px] tg-muted">
              {[c.rom.crc && `CRC ${c.rom.crc}`, c.rom.md5 && `MD5 ${c.rom.md5}`, c.rom.sha1 && `SHA1 ${c.rom.sha1}`].filter(Boolean).join(' · ')}
            </span>
            {c.rom.languages.length > 0 && <span className="block tg-muted">Languages: {c.rom.languages.join(', ').toUpperCase()}</span>}
            {c.rom.support_type && <span className="block tg-muted">Media: {c.rom.support_type}{c.rom.discs ? ` · disc ${c.rom.disc ?? '1'} of ${c.rom.discs}` : ''}</span>}
          </Row>
        )}
        {c.roms_total > 0 && (
          <Row label={`Known dumps (${c.roms_total})`}>
            <span className="flex flex-col gap-0.5">
              {c.roms.map(r => <span key={r.id ?? r.filename ?? ''} className="truncate" title={romLine(r)}>{romLine(r)}</span>)}
              {c.roms_total > c.roms.length && <span className="tg-muted">…and {c.roms_total - c.roms.length} more (all kept in the full record)</span>}
            </span>
          </Row>
        )}
        {(c.hacks_total > 0 || c.actions_total > 0) && (
          <Row label="Also">{[c.hacks_total ? `${c.hacks_total} hacks` : null, c.actions_total ? `${c.actions_total} control mappings` : null].filter(Boolean).join(' · ')}</Row>
        )}
      </dl>
      <button type="button" onClick={loadRaw} aria-expanded={!!raw} className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 self-start text-[12.5px] font-semibold text-[var(--tg-accent)]">
        <ChevronDown className={`h-4 w-4 transition-transform ${raw ? 'rotate-180' : ''}`} aria-hidden />
        {rawState === 'loading' ? 'Loading their full answer…' : raw ? 'Hide their full answer' : storedRaw ? 'Show the full saved record (raw)' : 'Show their full answer (raw)'}
      </button>
      {rawState === 'error' && <p className="text-[12px] text-[var(--tg-red)]">Could not load it — the server function may need redeploying.</p>}
      {raw != null && (
        <pre className="tg-scroll-y max-h-[420px] overflow-x-auto rounded-xl border border-[var(--tg-border)] bg-[var(--tg-panel-2)] p-3 font-mono text-[11px] leading-relaxed text-[var(--tg-text-2)]">
          {JSON.stringify(raw, null, 2)}
        </pre>
      )}
    </div>
  )
}
