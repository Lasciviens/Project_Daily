import { useMemo } from 'react'
import { CoverImg } from '../../components/gameCardKit'
import { coverCandidates, platformInfo, type TgGame } from '../testGameModel'
import { findDuplicates } from '../tgDuplicates'
import { Truncate } from '../../../../shared/ui/Truncate'

const LIBRARY_LABEL: Record<string, string> = { retro: 'Retro', steam: 'Steam', playstation: 'PlayStation' }

/**
 * Advanced → Duplicates: games sharing a title or a cover picture. Nothing is
 * merged or deleted here — open a game to hide or delete the extra copy.
 */
export function TgDuplicatesTab({ games, onOpenDetail }: { games: TgGame[]; onOpenDetail: (id: string) => void }) {
  const groups = useMemo(() => findDuplicates(games), [games])

  if (groups.length === 0) return (
    <p className="py-16 text-center text-[13px] tg-muted">No duplicates — no two games share a title or a cover.</p>
  )

  return (
    <div className="@container flex flex-col gap-3">
      <p className="text-[12.5px] tg-muted">
        {groups.length} possible duplicate{groups.length === 1 ? '' : 's'}. Same platform first — those are the likeliest real duplicates;
        a game you own on two platforms is listed too. Open one to hide or delete the extra copy.
      </p>
      <ul className="grid grid-cols-1 gap-3 @[48rem]:grid-cols-2">
        {groups.map(g => (
          <li key={`${g.reason}:${g.key}`} className="rounded-xl border border-[var(--tg-border)] p-3">
            <p className="mb-2 flex items-center gap-2 text-[11.5px] tg-muted">
              <span className="rounded-full bg-[var(--tg-accent-soft)] px-2 py-0.5 font-semibold text-[var(--tg-accent)]">
                {g.reason === 'title' ? 'Same title' : 'Same cover'}
              </span>
              {g.samePlatform ? 'same platform' : 'different platforms'}
            </p>
            <ul className="flex flex-col gap-1">
              {g.games.map(x => (
                <li key={x.id}>
                  <button type="button" onClick={() => onOpenDetail(x.id)} className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-1.5 text-left hover:bg-[var(--tg-hover)]">
                    <CoverImg url={coverCandidates(x)[0] ?? null} title={x.title} className="h-11 w-8 shrink-0 rounded" />
                    <span className="min-w-0 flex-1">
                      <Truncate className="block text-[13.5px] font-medium text-[var(--tg-text)]">{x.title}</Truncate>
                      <span className="block text-[11.5px] tg-muted">
                        {[platformInfo(x.platformKey).name, LIBRARY_LABEL[x.library] ?? x.library, x.release_year, x.hidden ? 'Hidden' : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
