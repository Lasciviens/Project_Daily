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

function Expand({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex min-h-[32px] items-center font-semibold text-[var(--tg-accent)] [@media(pointer:coarse)]:min-h-[44px]">
        {open ? 'Hide' : label}
      </button>
      {open && <span className="mt-1 block">{children}</span>}
    </>
  )
}

const romLine = (r: SsRomInfo) => [r.filename, formatBytes(r.size), r.regions.join('/').toUpperCase() || null, r.flags.join(', ') || null].filter(Boolean).join(' · ')

/**
 * Everything else ScreenScraper knows about the entry — every regional title
 * and date, every rating board, series, themes and styles, controls, tips,
 * hacks, the matched dump with its hashes and serial, every known dump, the
 * pictograms and logos attached to it — and, on request, their whole answer
 * (every URL removed).
 */
export function TgScrapeRecord({ candidate: c, storedRaw }: {
  candidate: SsCandidate
  /** The record as saved with the game — shown without asking ScreenScraper again. */
  storedRaw?: unknown
}) {
  const [raw, setRaw] = useState<unknown>(null)
  const [rawState, setRawState] = useState<'idle' | 'loading' | 'error'>('idle')

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

  const lists: [string, string[] | undefined][] = [
    ['Genres', c.genres], ['Modes', c.modes], ['Series', c.families], ['Number', c.numbers], ['Themes', c.themes], ['Styles', c.styles],
  ]
  const extras = c.extra_media ?? []
  const extraSummary = [...new Set(extras.map(m => m.parent))].map(p => `${p} ${extras.filter(m => m.parent === p).length}`).join(' · ')
  return (
    <div className="flex flex-col gap-1">
      <dl className="divide-y divide-[var(--tg-border)]">
        <Row label="ScreenScraper id">#{c.jeu_id}{c.rom_id ? ` · ROM #${c.rom_id}` : ''}{c.clone_of ? ` · clone of #${c.clone_of}` : ''}</Row>
        {c.note20 != null && <Row label="Their score">{c.note20}/20{c.top_staff ? ' · staff pick' : ''}</Row>}
        {c.names.length > 0 && <Row label={`Titles (${c.names.length})`}><Keyed list={c.names} /></Row>}
        {c.dates.length > 0 && <Row label={`Released (${c.dates.length})`}><Keyed list={c.dates} /></Row>}
        {c.classifications.length > 0 && <Row label="Age ratings"><Keyed list={c.classifications} /></Row>}
        {lists.filter(([, v]) => v?.length).map(([k, v]) => <Row key={k} label={k}>{v!.join(', ')}</Row>)}
        {c.rotation && <Row label="Screen rotation">{c.rotation}°</Row>}
        {c.resolution && <Row label="Resolution">{c.resolution}</Row>}
        {c.controls && <Row label="Controls">{c.controls}</Row>}
        {c.colours && <Row label="Colours">{c.colours}</Row>}
        {c.synopses.length > 0 && (
          <Row label={`Descriptions (${c.synopses.length})`}>
            <Expand label={`Show all (${c.synopses.map(s => s.key.toUpperCase()).join(', ')})`}><span className="whitespace-pre-line"><Keyed list={c.synopses} /></span></Expand>
          </Row>
        )}
        {(c.tips?.length ?? 0) > 0 && (
          <Row label={`Tips (${c.tips.length})`}>
            <Expand label="Show tips">
              <span className="flex flex-col gap-1.5">
                {c.tips.map((t, i) => <span key={i}><span className="mr-1 text-[10.5px] font-semibold uppercase tg-muted">{t.lang}</span>{t.title && <b className="font-semibold">{t.title}: </b>}{t.text}</span>)}
              </span>
            </Expand>
          </Row>
        )}
        {(c.actions?.length ?? 0) > 0 && (
          <Row label={`Controls map (${c.actions.length})`}>
            <Expand label="Show mappings"><span className="flex flex-col gap-0.5 font-mono text-[11.5px]">{c.actions.map((a, i) => <span key={i}>{a}</span>)}</span></Expand>
          </Row>
        )}
        {c.rom && (
          <Row label="Matched ROM">
            <span className="block break-all">{romLine(c.rom)}</span>
            <span className="mt-0.5 block break-all font-mono text-[11px] tg-muted">
              {[c.rom.crc && `CRC ${c.rom.crc}`, c.rom.md5 && `MD5 ${c.rom.md5}`, c.rom.sha1 && `SHA1 ${c.rom.sha1}`].filter(Boolean).join(' · ')}
            </span>
            {c.rom.serial && <span className="block tg-muted">Serial: {c.rom.serial}</span>}
            {c.rom.languages.length > 0 && <span className="block tg-muted">Languages: {c.rom.languages.join(', ').toUpperCase()}</span>}
            {(c.rom.support_type || c.rom.type) && <span className="block tg-muted">Media: {[c.rom.type, c.rom.support_type].filter(Boolean).join(' · ')}{c.rom.discs ? ` · disc ${c.rom.disc ?? '1'} of ${c.rom.discs}` : ''}</span>}
            {c.rom.clone_of && <span className="block tg-muted">Clone of ROM #{c.rom.clone_of}</span>}
          </Row>
        )}
        {c.roms_total > 0 && (
          <Row label={`Known dumps (${c.roms_total})`}>
            <span className="flex flex-col gap-0.5">
              {c.roms.map(r => <span key={r.id ?? r.filename ?? ''} className="break-all">{romLine(r)}</span>)}
              {c.roms_total > c.roms.length && <span className="tg-muted">…and {c.roms_total - c.roms.length} more (kept in the full record)</span>}
            </span>
          </Row>
        )}
        {(c.hacks?.length ?? 0) > 0 && (
          <Row label={`Hacks (${c.hacks_total})`}>
            <Expand label="Show hacks">
              <span className="flex flex-col gap-1">
                {c.hacks.map((h, i) => (
                  <span key={h.id ?? i}>
                    <b className="font-semibold">{h.name ?? 'Untitled'}</b>{h.author ? ` · ${h.author}` : ''}{h.version ? ` · v${h.version}` : ''}{h.status ? ` · ${h.status}` : ''}
                    {h.synopses[0] && <span className="block tg-muted">{h.synopses[0].text.slice(0, 220)}{h.synopses[0].text.length > 220 ? '…' : ''}</span>}
                  </span>
                ))}
              </span>
            </Expand>
          </Row>
        )}
        {extras.length > 0 && <Row label="Pictograms & logos">{extraSummary}</Row>}
      </dl>
      <button type="button" onClick={loadRaw} aria-expanded={!!raw} className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 self-start text-[12.5px] font-semibold text-[var(--tg-accent)]">
        <ChevronDown className={`h-4 w-4 transition-transform ${raw ? 'rotate-180' : ''}`} aria-hidden />
        {rawState === 'loading' ? 'Loading their full answer…' : raw ? 'Hide the full answer' : storedRaw ? 'Show the full saved record (raw)' : 'Show their full answer (raw)'}
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
