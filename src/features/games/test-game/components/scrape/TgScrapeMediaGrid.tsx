import { useState } from 'react'
import { ExternalLink, FileText, Film } from 'lucide-react'
import type { SsCandidate, SsMediaEntry } from '../../../scraper/ssTypes'
import type { MediaMode } from '../../../scraper/ssMediaCatalog'
import { ssMediaUrl } from '../../../scraper/ssApi'
import { TgLightbox } from '../TgLightbox'
import { formatBytes, groupMediaRows, type MediaRow } from './tgScrapeModel'
import { TgSegmented, TgSsMedia } from './TgScrapeParts'

const MODE_OPTIONS = (canStore: boolean): { value: MediaMode; label: string; disabled?: boolean; hint?: string }[] => [
  { value: 'store', label: 'Save', disabled: !canStore, hint: canStore ? 'Save a resized copy in your storage' : 'Manuals and videos are never copied — Link streams them' },
  { value: 'on_demand', label: 'Link', hint: 'Keep no copy; fetch from ScreenScraper when you look at it' },
  { value: 'skip', label: 'Skip', hint: 'Ignore this file' },
]

const entryLabel = (e: SsMediaEntry) => [e.region?.toUpperCase(), e.support ? `disc ${e.support}` : null].filter(Boolean).join(' · ') || 'Any'

/**
 * Every file they have, one card per type: a preview, the region, its size,
 * and Save / Link / Skip. Previews come through the signed proxy, so looking
 * costs no storage.
 */
export function TgScrapeMediaGrid({ candidate, rows, modes, tokens, onMode, onToken, readOnly }: {
  candidate: SsCandidate
  rows: MediaRow[]
  modes: Record<string, MediaMode>
  tokens: Record<string, string>
  onMode: (type: string, m: MediaMode) => void
  onToken: (type: string, token: string) => void
  readOnly: boolean
}) {
  const [zoom, setZoom] = useState<number | null>(null)
  const ref = { jeuId: candidate.jeu_id, systemId: candidate.system.id, sig: candidate.media_sig }
  const imageRows = rows.filter(r => r.info.kind === 'image')
  const entryOf = (r: MediaRow) => r.entries.find(e => e.token === tokens[r.type]) ?? r.chosen
  const zoomUrls = imageRows.map(r => ssMediaUrl(ref, entryOf(r), { width: 1280 })).filter((u): u is string => !!u)

  if (!rows.length) return <p className="text-[13px] tg-muted">ScreenScraper has no files for this entry.</p>

  return (
    <div className="flex flex-col gap-5">
      {groupMediaRows(rows).map(g => (
        <div key={g.key}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold text-[var(--tg-text-2)]">{g.label}</h3>
            {!readOnly && g.rows.length > 1 && (
              <span className="flex items-center gap-0.5 text-[11.5px]">
                <span className="mr-1 tg-faint">All:</span>
                {(['store', 'on_demand', 'skip'] as MediaMode[]).map(m => (
                  <button
                    key={m} type="button"
                    onClick={() => g.rows.forEach(r => onMode(r.type, m === 'store' && !r.canStore ? 'on_demand' : m))}
                    className="min-h-[32px] rounded-md px-1.5 font-semibold text-[var(--tg-accent)] [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(pointer:coarse)]:min-h-[40px]"
                  >
                    {m === 'store' ? 'Save' : m === 'on_demand' ? 'Link' : 'Skip'}
                  </button>
                ))}
              </span>
            )}
          </div>
          <ul className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2 2xl:grid-cols-3">
            {g.rows.map(r => {
              const entry = entryOf(r)
              const mode = modes[r.type] ?? r.mode
              const url = ssMediaUrl(ref, entry, r.info.kind === 'image' ? { width: 1280 } : {})
              const zoomIndex = r.info.kind === 'image' ? imageRows.findIndex(x => x.type === r.type) : -1
              return (
                <li key={r.type} className={`flex gap-3 rounded-[14px] border p-2.5 ${mode === 'skip' ? 'border-[var(--tg-border)] opacity-60' : 'border-[var(--tg-border)] bg-[var(--tg-panel)]'}`}>
                  {r.info.kind === 'image' ? (
                    <button
                      type="button" onClick={() => setZoom(zoomIndex)} aria-label={`Preview ${r.info.label}`}
                      className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-[var(--tg-panel-2)]"
                    >
                      <TgSsMedia candidate={candidate} entry={entry} width={200} className="h-full w-full" />
                    </button>
                  ) : (
                    <a
                      href={url ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open ${r.info.label}`}
                      className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-lg bg-[var(--tg-panel-2)] text-[var(--tg-accent)]"
                    >
                      {r.info.kind === 'pdf' ? <FileText className="h-7 w-7" strokeWidth={1.6} aria-hidden /> : <Film className="h-7 w-7" strokeWidth={1.6} aria-hidden />}
                    </a>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">{r.info.label}</span>
                        <span className="block truncate text-[11px] tabular-nums tg-muted">
                          {[entry.format?.toUpperCase(), formatBytes(entry.size), r.entries.length > 1 ? `${r.entries.length} versions` : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {r.info.kind !== 'image' && url && (
                        <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-semibold text-[var(--tg-accent)]">
                          Open <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      )}
                    </div>
                    {r.entries.length > 1 && (
                      <select
                        value={entry.token} onChange={e => onToken(r.type, e.target.value)} aria-label={`${r.info.label} version`}
                        className="h-8 rounded-md border border-[var(--tg-border)] bg-[var(--tg-panel)] px-2 text-[12px] [@media(pointer:coarse)]:h-10"
                      >
                        {r.entries.map(e => <option key={e.token} value={e.token}>{entryLabel(e)}</option>)}
                      </select>
                    )}
                    {!readOnly && (
                      <TgSegmented size="sm" label={`${r.info.label}: save, link or skip`} value={mode} options={MODE_OPTIONS(r.canStore)} onChange={m => onMode(r.type, m)} />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <TgLightbox images={zoomUrls} index={zoom} onClose={() => setZoom(null)} onIndex={setZoom} />
    </div>
  )
}
