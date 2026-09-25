import { CircleAlert, CircleCheckBig, Link2, Save, Undo2 } from 'lucide-react'
import type { TgGame } from '../../testGameModel'
import { useTestGameStore } from '../../testGameStore'
import { useTgBreakpoint } from '../../useTgBreakpoint'
import type { ApplyResult } from '../../../scraper/ssApi'
import { useUndoScrape } from '../../../scraper/useScrape'
import { FIELD_LABEL } from '../../../scraper/ssPlan'
import { mediaInfo } from '../../../scraper/ssMediaCatalog'
import { formatBytes } from './tgScrapeModel'

const TITLE: Record<ApplyResult['outcome'], string> = {
  applied: 'Saved', no_match: 'Not found any more', stale: 'The entry changed', error: 'Could not save',
}

/** What the save actually did — field by field, file by file — with Undo. */
export function TgScrapeApplied({ game, runId, result, onBack, onAgain }: {
  game: TgGame
  runId: string
  result: ApplyResult
  onBack?: () => void
  onAgain: () => void
}) {
  const undo = useUndoScrape()
  const bp = useTgBreakpoint()
  const setSection = useTestGameStore(s => s.setSection)
  const openDetail = useTestGameStore(s => s.openDetail)
  const activateGame = useTestGameStore(s => s.activateGame)
  const ok = result.outcome === 'applied'
  const saved = (result.media ?? []).filter(m => m.ok && m.mode === 'store')
  const linked = (result.media ?? []).filter(m => m.ok && m.mode === 'on_demand')
  const failed = (result.media ?? []).filter(m => !m.ok)
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
            <h2 className="text-[17px] font-bold">{TITLE[result.outcome]}</h2>
            <p className="text-[12.5px] tg-muted">{ok ? `${game.title} ← ${result.matched_title ?? 'ScreenScraper'}` : result.reason}</p>
          </div>
        </div>

        {ok && (
          <dl className="mt-4 grid gap-3 text-[13px]">
            <div>
              <dt className="tg-section-label mb-1">Fields written</dt>
              <dd>{result.written?.length ? result.written.map(f => FIELD_LABEL[f]).join(', ') : <span className="tg-muted">None — nothing new, or everything was set to Keep</span>}</dd>
            </div>
            <div>
              <dt className="tg-section-label mb-1 flex items-center gap-1.5"><Save className="h-3.5 w-3.5" aria-hidden />Saved to storage · {formatBytes(result.bytes_stored ?? 0)}</dt>
              <dd>{saved.length ? saved.map(m => `${mediaInfo(m.type).label} (${formatBytes(m.bytes)})`).join(', ') : <span className="tg-muted">None</span>}</dd>
            </div>
            <div>
              <dt className="tg-section-label mb-1 flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" aria-hidden />Linked (no storage)</dt>
              <dd>{linked.length ? linked.map(m => mediaInfo(m.type).label).join(', ') : <span className="tg-muted">None</span>}</dd>
              {linked.some(m => m.reason) && <dd className="mt-1 text-[12px] text-[var(--tg-red)]">{[...new Set(linked.filter(m => m.reason).map(m => m.reason))].join(' · ')}</dd>}
            </div>
            {failed.length > 0 && (
              <div>
                <dt className="tg-section-label mb-1 text-[var(--tg-red)]">Did not work</dt>
                <dd className="text-[12.5px]">{failed.map(m => `${m.type === 'platform' ? 'Platform fields' : mediaInfo(m.type).label}: ${m.reason}`).join(' · ')}</dd>
              </div>
            )}
          </dl>
        )}
        {result.remaining_today != null && <p className="mt-4 text-[11.5px] tabular-nums tg-faint">{result.remaining_today.toLocaleString('en-GB')} ScreenScraper requests left today</p>}
      </section>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {ok && (
          <button type="button" onClick={() => undo.mutate({ runId, gameIds: [game.id] }, { onSuccess: onAgain })} disabled={undo.isPending} className="tg-btn tg-btn-secondary">
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
