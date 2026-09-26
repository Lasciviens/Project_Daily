import { CircleAlert, CircleCheckBig, Link2, Save, Undo2 } from 'lucide-react'
import type { TgGame } from '../../testGameModel'
import { useTestGameStore } from '../../testGameStore'
import { useTgBreakpoint } from '../../useTgBreakpoint'
import type { ApplyResult } from '../../../scraper/ssApi'
import { useUndoScrape } from '../../../scraper/useScrape'
import { FIELD_LABEL } from '../../../scraper/ssPlan'
import { mediaInfo } from '../../../scraper/ssMediaCatalog'
import { display, formatBytes, type FieldRow } from './tgScrapeModel'

const TITLE: Record<ApplyResult['outcome'], string> = {
  applied: 'Saved', no_match: 'Not found any more', stale: 'The entry changed', error: 'Could not save',
}

/** What the save actually did — each field old → new, each file copied,
 *  online or failed — with Undo (also available later under Recent saves). */
export function TgScrapeApplied({ game, runId, result, rows, onBack, onAgain }: {
  game: TgGame
  runId: string
  result: ApplyResult
  rows: FieldRow[]
  onBack?: () => void
  onAgain: () => void
}) {
  const undo = useUndoScrape()
  const bp = useTgBreakpoint()
  const setSection = useTestGameStore(s => s.setSection)
  const openDetail = useTestGameStore(s => s.openDetail)
  const activateGame = useTestGameStore(s => s.activateGame)
  const ok = result.outcome === 'applied'
  const copied = (result.media ?? []).filter(m => m.ok && m.mode === 'store')
  const online = (result.media ?? []).filter(m => m.ok && m.mode === 'on_demand')
  const failed = (result.media ?? []).filter(m => !m.ok)
  const reasons = [...new Set(online.filter(m => m.reason).map(m => m.reason!))]
  const openGame = () => {
    setSection('library')
    if (bp === 'mobile') openDetail(game.id)
    else activateGame(game.id)
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="tg-panel p-5">
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${ok ? 'bg-[var(--tg-green-soft)] text-[var(--tg-green)]' : 'bg-[var(--tg-red-soft)] text-[var(--tg-red)]'}`}>
            {ok ? <CircleCheckBig className="h-5 w-5" aria-hidden /> : <CircleAlert className="h-5 w-5" aria-hidden />}
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold">{ok ? `Saved to ${game.title}` : TITLE[result.outcome]}</h2>
            <p className="text-[12.5px] tg-muted">
              {ok ? `From ScreenScraper: ${result.matched_title ?? '—'}${result.verified_rom ? ' · your exact ROM' : ''}` : result.reason}
            </p>
          </div>
        </div>

        {ok && (
          <div className="mt-4 flex flex-col gap-4 text-[13px]">
            <div>
              <h3 className="tg-section-label mb-1.5">Fields written · {result.written?.length ?? 0}</h3>
              {result.written?.length ? (
                <dl className="flex flex-col gap-1">
                  {result.written.map(f => {
                    const row = rows.find(r => r.field === f)
                    return (
                      <div key={f} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                        <dt className="tg-muted">{FIELD_LABEL[f]}</dt>
                        <dd className="min-w-0 break-words">
                          {row && !row.isImage && !row.currentEmpty && <span className="mr-1.5 line-through tg-faint">{display(row.current, f).slice(0, 80)}</span>}
                          {row?.isImage ? 'new image' : row ? display(row.theirs, f).slice(0, 140) : '—'}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              ) : <p className="tg-muted">None — nothing new, or every field was set to Keep.</p>}
            </div>
            <div>
              <h3 className="tg-section-label mb-1 flex items-center gap-1.5"><Save className="h-3.5 w-3.5" aria-hidden />Copied to storage · {formatBytes(result.bytes_stored ?? 0)}</h3>
              <p>{copied.length ? copied.map(m => `${mediaInfo(m.type).label} (${formatBytes(m.bytes)})`).join(', ') : <span className="tg-muted">None</span>}</p>
            </div>
            <div>
              <h3 className="tg-section-label mb-1 flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" aria-hidden />Shown online (no storage)</h3>
              <p>{online.length ? online.map(m => mediaInfo(m.type).label).join(', ') : <span className="tg-muted">None</span>}</p>
              {reasons.length > 0 && <p className="mt-1 text-[12px] tg-muted">{reasons.join(' · ')}</p>}
            </div>
            {failed.length > 0 && (
              <div>
                <h3 className="tg-section-label mb-1 text-[var(--tg-red)]">Did not work</h3>
                <p className="text-[12.5px]">{failed.map(m => `${m.type === 'platform' ? 'Platform fields' : mediaInfo(m.type).label}: ${m.reason}`).join(' · ')}</p>
              </div>
            )}
          </div>
        )}
        {result.remaining_today != null && <p className="mt-4 text-[11.5px] tabular-nums tg-faint">{result.remaining_today.toLocaleString('en-GB')} ScreenScraper requests left today</p>}
      </section>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {ok && (
          <button
            type="button"
            onClick={() => undo.mutate({ runId, gameIds: [game.id] }, { onSuccess: (r) => { if (r.status === 'ok' && r.reverted) onAgain() } })}
            disabled={undo.isPending}
            className="tg-btn tg-btn-secondary"
          >
            <Undo2 className="h-4 w-4" aria-hidden /> {undo.isPending ? 'Undoing…' : 'Undo'}
          </button>
        )}
        <button type="button" onClick={openGame} className="tg-btn tg-btn-primary">Open the game</button>
        {onBack ? (
          <button type="button" onClick={onBack} className="tg-btn tg-btn-secondary">Back to results</button>
        ) : (
          <button type="button" onClick={onAgain} className="tg-btn tg-btn-secondary">Review again</button>
        )}
      </div>
    </div>
  )
}
