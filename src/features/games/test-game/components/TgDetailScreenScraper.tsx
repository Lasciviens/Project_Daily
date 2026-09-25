import { useMemo, useState, type ReactNode } from 'react'
import { ExternalLink, FileText, Film } from 'lucide-react'
import type { TgGame } from '../testGameModel'
import { useTestGameStore } from '../testGameStore'
import type { SsCandidate, SsMediaEntry } from '../../scraper/ssTypes'
import { ssGamePage, ssMediaUrl, type ProviderDataV2 } from '../../scraper/ssApi'
import { useGameScrapeData, useScrapePrefs } from '../../scraper/useScrape'
import { SsImage } from '../../scraper/SsImage'
import { mediaInfo } from '../../scraper/ssMediaCatalog'
import { mediaModeFor } from '../../scraper/ssPlan'
import { pickMediaEntry } from '../../scraper/ssRules'
import { TgLightbox } from './TgLightbox'
import { TgScrapeRecord } from './scrape/TgScrapeRecord'
import { TgSsAttribution } from './scrape/TgScrapeParts'
import { formatBytes } from './scrape/tgScrapeModel'

const PREVIEW = 8

interface Tile { type: string; label: string; entry: SsMediaEntry; stored: string | null; kind: 'image' | 'pdf' | 'video' }

/**
 * The detail's "ScreenScraper" block: everything saved from their record, and
 * a gallery of every file they have — saved copies straight from Storage, the
 * rest fetched on demand through the signed proxy. Loaded for the open game
 * only; the library list never carries this blob.
 */
export function TgDetailScreenScraper({ game }: { game: TgGame }) {
  const q = useGameScrapeData(game.library === 'retro' ? game.id : null)
  const openScrape = useTestGameStore(s => s.openScrape)
  if (game.library !== 'retro' || q.isLoading || q.error) return null
  const data = q.data
  const again = (
    <button type="button" onClick={() => openScrape(game.id)} className="inline-flex min-h-[36px] items-center text-[12.5px] font-semibold text-[var(--tg-accent)]">
      {data?.provider ? 'Scrape again' : 'Scrape now'}
    </button>
  )
  if (!data?.provider) {
    return (
      <section className="flex flex-col gap-1.5 border-t border-[var(--tg-border)] pt-3.5">
        <h3 className="tg-section-label">ScreenScraper</h3>
        <p className="text-[12.5px] tg-muted">
          {data?.legacy ? 'Matched with the old scraper, which kept only part of their record.' : 'Not matched yet.'}
        </p>
        {again}
      </section>
    )
  }
  return <ProviderBlock game={game} p={data.provider} again={again} />
}

function ProviderBlock({ p, again }: { game: TgGame; p: ProviderDataV2; again: ReactNode }) {
  const { prefs } = useScrapePrefs()
  const [all, setAll] = useState(false)
  const [zoom, setZoom] = useState<number | null>(null)
  const candidate: SsCandidate = { ...(p.summary as SsCandidate), media: p.summary?.media ?? [], media_sig: p.media_sig }
  const ref = { jeuId: p.jeu_id, systemId: p.system_id, sig: p.media_sig }

  // One tile per type: saved copies first, then what is linked, then the rest
  // they have (never a skipped type unless "Show all").
  const tiles = useMemo((): Tile[] => {
    const types = [...new Set(candidate.media.map(m => m.type))]
    const rank = (t: string) => (p.saved[t] ? 0 : p.linked.includes(t) ? 1 : mediaModeFor(prefs, t) === 'skip' ? 3 : 2)
    return types
      .map(t => {
        const info = mediaInfo(t)
        return { type: t, label: info.label, kind: info.kind, stored: p.saved[t] ?? null, entry: pickMediaEntry(candidate.media, t, prefs.regions)! }
      })
      .filter(x => x.entry)
      .sort((a, b) => rank(a.type) - rank(b.type))
  }, [candidate.media, p.saved, p.linked, prefs])
  const visible = tiles.filter(t => all || mediaModeFor(prefs, t.type) !== 'skip' || p.saved[t.type])
  const shown = all ? visible : visible.slice(0, PREVIEW)
  const images = shown.filter(t => t.kind === 'image')
  const zoomUrls = images.map(t => t.stored ?? ssMediaUrl(ref, t.entry, { width: 1280 }) ?? '').filter(Boolean)

  return (
    <section className="flex flex-col gap-3 border-t border-[var(--tg-border)] pt-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="tg-section-label">ScreenScraper</h3>
        <a href={ssGamePage(p.jeu_id)} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] items-center gap-1 text-[12px] font-semibold text-[var(--tg-accent)]">
          #{p.jeu_id} <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
      <p className="-mt-1.5 text-[11.5px] tg-faint">
        Fetched {new Date(p.fetched_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        {p.system_name ? ` · ${p.system_name}` : ''} · {candidate.media.length} files · {Object.keys(p.saved).length} saved
      </p>

      {shown.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4">
          {shown.map(t => {
            const index = images.indexOf(t)
            const src = t.stored ?? ssMediaUrl(ref, t.entry, { width: 240, format: mediaInfo(t.type).alpha ? 'png' : 'jpg' })
            return (
              <li key={t.type} className="flex min-w-0 flex-col gap-1">
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
                  {t.label}{t.stored ? ' · saved' : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {tiles.length > shown.length || all ? (
        <button type="button" onClick={() => setAll(a => !a)} className="-mt-1 min-h-[36px] self-start text-[12px] font-semibold text-[var(--tg-accent)]">
          {all ? 'Show fewer' : `Show all ${tiles.length} files`}
        </button>
      ) : null}

      <TgScrapeRecord candidate={candidate} storedRaw={p.jeu} />
      <div className="flex items-center justify-between gap-3">
        <TgSsAttribution />
        {again}
      </div>
      <TgLightbox images={zoomUrls} index={zoom} onClose={() => setZoom(null)} onIndex={setZoom} />
    </section>
  )
}
