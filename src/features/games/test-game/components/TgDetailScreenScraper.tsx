import { useMemo, useState, type ReactNode } from 'react'
import { ExternalLink, FileText, Film, Undo2 } from 'lucide-react'
import { formatDay, type TgGame } from '../testGameModel'
import { useTestGameStore } from '../testGameStore'
import type { SsCandidate, SsMediaEntry } from '../../scraper/ssTypes'
import { ssGamePage, ssMediaUrl, type GameScrapeData } from '../../scraper/ssApi'
import { useGameScrapeData, useScrapePrefs, useUndoScrape } from '../../scraper/useScrape'
import { SsImage } from '../../scraper/SsImage'
import { mediaInfo } from '../../scraper/ssMediaCatalog'
import { mediaModeFor } from '../../scraper/ssPlan'
import { pickMediaEntry } from '../../scraper/ssRules'
import { TgLightbox } from './TgLightbox'
import { TgScrapeRecord } from './scrape/TgScrapeRecord'
import { TgSsAttribution } from './scrape/TgScrapeParts'
import { formatBytes } from './scrape/tgScrapeModel'

const PREVIEW = 8

interface Tile { key: string; type: string; label: string; entry: SsMediaEntry; stored: string | null; kind: 'image' | 'pdf' | 'video' }

/**
 * The detail's "ScreenScraper" block: everything saved from their record, and
 * a gallery of every file they have — copies straight from Storage, the rest
 * shown online through the signed proxy (a fresh signature per visit; none is
 * stored). Loaded for the open game only; the library list never carries it.
 */
export function TgDetailScreenScraper({ game }: { game: TgGame }) {
  const q = useGameScrapeData(game.library === 'retro' ? game.id : null)
  const openScrape = useTestGameStore(s => s.openScrape)
  if (game.library !== 'retro' || q.isLoading || q.error) return null
  const data = q.data
  const again = (
    <button type="button" onClick={() => openScrape(game.id)} className="inline-flex min-h-[44px] items-center text-[12.5px] font-semibold text-[var(--tg-accent)]">
      {data?.provider ? 'Scrape again' : 'Scrape now'}
    </button>
  )
  if (!data?.provider || !data.summary) {
    return (
      <section className="flex flex-col gap-1.5 border-t border-[var(--tg-border)] pt-3.5">
        <h3 className="tg-section-label">ScreenScraper</h3>
        <p className="text-[12.5px] tg-muted">
          {data?.provider
            ? `Matched to #${data.provider.jeu_id}, but their full record is not saved here — scrape again to fetch it.`
            : data?.legacy || game.ss_jeu_id || game.external_source === 'screenscraper'
              ? 'Matched with the old scraper, which kept only part of their record — scrape again to get all of it.'
              : 'Not matched yet.'}
        </p>
        {again}
      </section>
    )
  }
  return <ProviderBlock game={game} data={data} again={again} />
}

function ProviderBlock({ game, data, again }: { game: TgGame; data: GameScrapeData; again: ReactNode }) {
  const p = data.provider!
  const { prefs } = useScrapePrefs()
  const undo = useUndoScrape()
  const [all, setAll] = useState(false)
  const [zoom, setZoom] = useState<number | null>(null)
  const candidate: SsCandidate = { ...(data.summary as SsCandidate), media: data.summary?.media ?? [], media_sig: data.sig?.sig ?? null, media_exp: data.sig?.exp ?? null }
  const ref = { jeuId: p.jeu_id, systemId: p.system_id, sig: data.sig?.sig ?? null, exp: data.sig?.exp ?? null }
  const linked = useMemo(() => (p.linked && !Array.isArray(p.linked) ? p.linked : {}) as Record<string, string>, [p.linked])

  // One tile per type (the version chosen for it): copies first, then what
  // is online, then the rest they have. "Show all" adds every other version.
  const tiles = useMemo((): Tile[] => {
    const types = [...new Set(candidate.media.map(m => m.type))]
    const rank = (t: string) => (p.saved[t] ? 0 : linked[t] ? 1 : mediaModeFor(prefs, t) === 'skip' ? 3 : 2)
    const main = types
      .map(t => {
        const info = mediaInfo(t)
        const entry = candidate.media.find(m => m.token === linked[t]) ?? pickMediaEntry(candidate.media, t, prefs.regions)
        const tile: Tile | null = entry ? { key: entry.token, type: t, label: info.label, kind: info.kind, stored: p.saved[t] ?? null, entry } : null
        return tile
      })
      .filter((x): x is Tile => !!x)
      .sort((a, b) => rank(a.type) - rank(b.type))
    if (!all) return main
    const shown = new Set(main.map(t => t.key))
    const rest = candidate.media.filter(m => !shown.has(m.token)).map(m => {
      const info = mediaInfo(m.type)
      const tile: Tile = { key: m.token, type: m.type, label: `${info.label}${m.region ? ` · ${m.region.toUpperCase()}` : ''}${m.support ? ` · disc ${m.support}` : ''}`, kind: info.kind, stored: null, entry: m }
      return tile
    })
    return [...main, ...rest]
  }, [candidate.media, p.saved, linked, prefs, all])
  const visible = all ? tiles : tiles.filter(t => mediaModeFor(prefs, t.type) !== 'skip' || t.stored).slice(0, PREVIEW)
  const images = visible.filter(t => t.kind === 'image')
  const zoomUrls = images.map(t => t.stored ?? ssMediaUrl(ref, t.entry, { width: 1280 }) ?? '')
  const total = candidate.media.length

  return (
    <section className="flex flex-col gap-3 border-t border-[var(--tg-border)] pt-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="tg-section-label">ScreenScraper</h3>
        <a href={ssGamePage(p.jeu_id)} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-[12px] font-semibold text-[var(--tg-accent)]">
          #{p.jeu_id} <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
      <p className="-mt-2 text-[11.5px] tg-faint">
        Fetched {formatDay(p.fetched_at)}
        {p.system_name ? ` · ${p.system_name}` : ''} · {total} files · {Object.keys(p.saved).length} copied{p.verified_rom ? ' · your exact ROM' : ''}
      </p>

      {visible.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4">
          {visible.map(t => {
            const index = images.indexOf(t)
            const src = t.stored ?? ssMediaUrl(ref, t.entry, { width: 200, format: mediaInfo(t.type).alpha ? 'png' : 'jpg' })
            return (
              <li key={t.key} className="flex min-w-0 flex-col gap-1">
                {t.kind === 'image' ? (
                  <button type="button" onClick={() => setZoom(index)} aria-label={`View ${t.label}`}
                    className="relative aspect-square overflow-hidden rounded-lg border border-[var(--tg-border)] bg-[var(--tg-panel-2)]">
                    <SsImage src={src} proxied={!t.stored} className="h-full w-full" imgClassName="h-full w-full object-contain"
                      fallback={<span className="absolute inset-0 grid place-items-center text-[10px] tg-faint">…</span>} />
                  </button>
                ) : (
                  <a href={ssMediaUrl(ref, t.entry) ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open ${t.label}`}
                    className="grid aspect-square place-items-center rounded-lg border border-[var(--tg-border)] bg-[var(--tg-panel-2)] text-[var(--tg-accent)]">
                    {t.kind === 'pdf' ? <FileText className="h-6 w-6" aria-hidden /> : <Film className="h-6 w-6" aria-hidden />}
                  </a>
                )}
                <span className="truncate text-[10.5px] leading-tight tg-muted" title={`${t.label} · ${formatBytes(t.entry.size)}`}>
                  {t.label}{t.stored ? ' · copy' : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div className="-mt-1 flex flex-wrap items-center gap-x-4">
        {(tiles.length > visible.length || all || total > tiles.length) && (
          <button type="button" onClick={() => setAll(a => !a)} className="min-h-[44px] text-[12px] font-semibold text-[var(--tg-accent)]">
            {all ? 'Show fewer' : `Show all ${total} files`}
          </button>
        )}
        {p.run_id && (
          <button type="button" onClick={() => undo.mutate({ runId: p.run_id!, gameIds: [game.id] })} disabled={undo.isPending} className="inline-flex min-h-[44px] items-center gap-1.5 text-[12px] font-semibold text-[var(--tg-accent)]">
            <Undo2 className="h-3.5 w-3.5" aria-hidden /> {undo.isPending ? 'Undoing…' : 'Undo last scrape'}
          </button>
        )}
      </div>

      <TgScrapeRecord candidate={candidate} storedRaw={data.raw ?? undefined} />
      <div className="flex items-center justify-between gap-3">
        <TgSsAttribution />
        {again}
      </div>
      <TgLightbox images={zoomUrls} index={zoom} onClose={() => setZoom(null)} onIndex={setZoom} />
    </section>
  )
}
