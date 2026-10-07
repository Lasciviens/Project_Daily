import { useContext, useMemo, useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { playSeconds, type TgGame } from '../testGameModel'
import { useTestGameStore } from '../testGameStore'
import { openIgdbFor } from './igdb/openIgdb'
import { formatLength, igdbPageUrl } from '../../igdb/igdbMatch'
import { useIgdbData, useUnlinkIgdb } from '../../igdb/useIgdb'
import { TgGamesContext } from './tgRanks'
import { TgConfirmDialog } from './TgConfirmDialog'
import { TgDetailDescription } from './TgDetailDescription'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { Truncate } from '../../../../shared/ui/Truncate'

const n = (v: number) => v.toLocaleString('en-GB')

function Tile({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div title={title} className="min-w-0 rounded-lg border border-[var(--tg-border)] bg-[var(--tg-panel-2)] px-2 py-1.5">
      <Truncate className="text-[10.5px] font-semibold uppercase tracking-wide tg-muted">{label}</Truncate>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="text-[14.5px] font-bold leading-tight tabular-nums text-[var(--tg-text)]">{value}</span>
        {sub && <Truncate className="min-w-0 text-[11px] tg-muted">{sub}</Truncate>}
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="tg-muted">{label}</dt><dd className="min-w-0 break-words text-[var(--tg-text)]">{children}</dd>
    </div>
  )
}

/**
 * The detail's "IGDB" block: how long the game takes, what IGDB members and
 * critics score it, what IGDB says about it that the library doesn't have
 * (themes, modes, perspective, franchise, engine, similar games), and a link
 * to its page. Not matched → a way to find it.
 */
export function TgDetailIgdb({ game, settled = true }: { game: TgGame; settled?: boolean }) {
  const matched = game.igdb_id != null
  const data = useIgdbData(matched && settled ? game.id : null)
  const library = useContext(TgGamesContext)
  const openDetail = useTestGameStore(s => s.openDetail)
  const unlink = useUnlinkIgdb()
  const [confirm, setConfirm] = useState(false)
  const owned = useMemo(() => {
    const m = new Map<number, TgGame>()
    for (const g of library) if (g.igdb_id != null && g.id !== game.id && !m.has(g.igdb_id)) m.set(g.igdb_id, g)
    return m
  }, [library, game.id])

  // Before migration 121 the columns are absent (undefined), not null: say nothing.
  if (game.igdb_id === undefined) return null

  if (!matched) {
    return (
      <section className="flex flex-col gap-1 border-t border-[var(--tg-border)] pt-2.5">
        <h3 className="tg-section-label">IGDB</h3>
        <p className="text-[12.5px] tg-muted">Not matched yet — IGDB adds how long it takes, member and critic scores, and a link to its page.</p>
        <button type="button" onClick={() => openIgdbFor(game.id)} className="inline-flex min-h-[32px] [@media(pointer:coarse)]:min-h-[44px] items-center self-start text-[12.5px] font-semibold text-[var(--tg-accent)]">Find on IGDB</button>
      </section>
    )
  }

  const page = igdbPageUrl(game)
  const main = formatLength(game.ttb_main_seconds), extra = formatLength(game.ttb_extra_seconds), full = formatLength(game.ttb_full_seconds)
  const played = playSeconds(game)
  const target = game.ttb_extra_seconds || game.ttb_main_seconds
  const d = data.data
  const description = !game.description?.trim() && d?.summary ? d.summary : null

  return (
    <section className="@container flex flex-col gap-2 border-t border-[var(--tg-border)] pt-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="tg-section-label">IGDB</h3>
        {page && (
          <a href={page} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] [@media(pointer:coarse)]:min-h-[44px] items-center gap-1 text-[12.5px] font-semibold text-[var(--tg-accent)]">
            Open on IGDB <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-[12px] font-semibold">How long to beat</h4>
        {main || extra || full ? (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              <Tile label="Main story" value={main ?? '—'} title="To the credits, without spending much time on extras" />
              <Tile label="+ Extras" value={extra ?? '—'} title="Story plus some side content" />
              <Tile label="100 %" value={full ?? '—'} title="Everything the game has" />
            </div>
            <p className="mt-0.5 text-[11.5px] tg-muted">
              {game.ttb_count ? `Averages from ${n(game.ttb_count)} IGDB member${game.ttb_count === 1 ? '' : 's'}.` : 'Averages from IGDB members.'}
              {played && target ? ` You've played ${formatLength(played)} of about ${formatLength(target)}.` : ''}
            </p>
          </>
        ) : <p className="text-[12.5px] tg-muted">IGDB has no length for this game yet.</p>}
      </div>

      {(game.igdb_total_rating != null || game.igdb_rating != null || game.igdb_critic_rating != null) && (
        <div>
          <h4 className="mb-1 text-[12px] font-semibold">Scores (out of 100)</h4>
          <div className="grid grid-cols-3 gap-1.5">
            <Tile label="Members" value={game.igdb_rating != null ? String(Math.round(game.igdb_rating)) : '—'}
              sub={game.igdb_rating_count ? `${n(game.igdb_rating_count)} ratings` : undefined} title="Average of IGDB members' ratings" />
            <Tile label="Critics" value={game.igdb_critic_rating != null ? String(Math.round(game.igdb_critic_rating)) : '—'}
              sub={game.igdb_critic_count ? `${n(game.igdb_critic_count)} reviews` : undefined} title="Average of press reviews IGDB collected" />
            <Tile label="Overall" value={game.igdb_total_rating != null ? String(Math.round(game.igdb_total_rating)) : '—'}
              sub={game.igdb_total_count ? `${n(game.igdb_total_count)} in all` : undefined} title="Members and critics together" />
          </div>
        </div>
      )}

      {d && (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px] leading-[1.4] @[34rem]:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]">
          {d.released && <Fact label="First released">{formatDate(d.released)}</Fact>}
          {d.type && !/main/i.test(d.type) && <Fact label="Type">{d.type}</Fact>}
          {d.themes.length > 0 && <Fact label="Themes">{d.themes.join(', ')}</Fact>}
          {d.modes.length > 0 && <Fact label="Modes">{d.modes.join(', ')}</Fact>}
          {d.perspectives.length > 0 && <Fact label="Perspective">{d.perspectives.join(', ')}</Fact>}
          {(d.franchises.length > 0 || d.collections.length > 0) && <Fact label="Franchise">{[...new Set([...d.franchises, ...d.collections])].join(', ')}</Fact>}
          {d.engines.length > 0 && <Fact label="Engine">{d.engines.join(', ')}</Fact>}
          {d.developers.length > 0 && <Fact label="Developer">{d.developers.join(', ')}</Fact>}
          {d.publishers.length > 0 && <Fact label="Publisher">{d.publishers.join(', ')}</Fact>}
          {d.platforms.length > 0 && <Fact label="Released on">{d.platforms.join(', ')}</Fact>}
          {d.hypes ? <Fact label="Followers">{`${n(d.hypes)} before release`}</Fact> : null}
        </dl>
      )}

      {description && <TgDetailDescription key={`igdb-${game.id}`} text={description} label="About (from IGDB)" mode="clamped" />}

      {d && d.similar.length > 0 && (
        <div>
          <h4 className="mb-0.5 text-[12px] font-semibold">Similar games</h4>
          <ul className="flex flex-col">
            {d.similar.map(s => {
              const mine = owned.get(s.id)
              return (
                <li key={s.id} className="flex min-h-[30px] items-center [@media(pointer:coarse)]:min-h-[44px] gap-2 text-[12.5px]">
                  <Truncate className="min-w-0 flex-1">{s.name}</Truncate>
                  {mine ? (
                    <button type="button" onClick={() => openDetail(mine.id)} className="shrink-0 font-semibold text-[var(--tg-green)]">In your library</button>
                  ) : s.slug ? (
                    <a href={`https://www.igdb.com/games/${s.slug}`} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 tg-muted" aria-label={`${s.name} on IGDB`}>
                      IGDB <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 text-[12.5px]">
        <button type="button" onClick={() => openIgdbFor(game.id)} className="inline-flex min-h-[32px] [@media(pointer:coarse)]:min-h-[44px] items-center font-semibold text-[var(--tg-accent)]">Change match</button>
        <button type="button" onClick={() => setConfirm(true)} disabled={unlink.isPending} className="inline-flex min-h-[32px] [@media(pointer:coarse)]:min-h-[44px] items-center font-semibold text-[var(--tg-red)]">Remove match</button>
        {game.igdb_fetched_at && <span className="inline-flex min-h-[32px] [@media(pointer:coarse)]:min-h-[44px] items-center tg-muted">Updated {formatDate(game.igdb_fetched_at)}</span>}
      </div>
      <TgConfirmDialog open={confirm} title="Remove the IGDB match?"
        message="Its length, scores and IGDB facts are cleared from this game. Nothing else changes."
        confirmLabel="Remove match" danger onClose={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); unlink.mutate(game.id) }} />
    </section>
  )
}
