import { useMemo, useState } from 'react'
import { GitMerge } from 'lucide-react'
import type { TgGame } from '../testGameModel'
import { findDuplicates, type DupGroup } from '../tgDuplicates'
import { TgCover } from './TgCover'
import { dupMeta } from './tgMergeFormat'
import { TgMergeDialog } from './TgMergeDialog'
import { Truncate } from '../../../../shared/ui/Truncate'

function Group({ group, onOpenDetail, onMerge }: { group: DupGroup<TgGame>; onOpenDetail: (id: string) => void; onMerge: () => void }) {
  return (
    <li className="rounded-xl border border-[var(--tg-border)] bg-[var(--tg-panel)]">
      <div className="flex items-center gap-2 border-b border-[var(--tg-border)] px-3 py-1">
        <span className="shrink-0 rounded-full bg-[var(--tg-accent-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--tg-accent)]">
          {group.reason === 'title' ? 'Same title' : 'Same cover'}
        </span>
        <Truncate className="min-w-0 flex-1 text-[12.5px] tg-muted">{group.samePlatform ? 'Same platform' : 'Different platforms'}</Truncate>
        <button
          type="button" onClick={onMerge}
          className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-[var(--tg-accent)] [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(pointer:coarse)]:min-h-[44px]"
        >
          <GitMerge aria-hidden className="h-4 w-4" /> Compare &amp; merge
        </button>
      </div>
      <ul>
        {group.games.map(g => (
          <li key={g.id}>
            <button
              type="button" onClick={() => onOpenDetail(g.id)}
              className="flex min-h-[52px] w-full items-center gap-3 px-3 py-1.5 text-left [@media(hover:hover)]:hover:bg-[var(--tg-hover)]"
            >
              <span className="block h-11 w-8 shrink-0 overflow-hidden rounded">
                <TgCover game={g} mode="contain" />
              </span>
              <span className="min-w-0 flex-1">
                <Truncate className="text-[14px] font-medium text-[var(--tg-text)]">{g.title}</Truncate>
                <Truncate className="text-[12.5px] text-[var(--tg-muted)]">{dupMeta(g)}</Truncate>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}

/**
 * Advanced → Duplicates: games sharing a title or a cover picture, as a
 * compact list. Nothing is merged on its own — "Compare & merge" opens a
 * side-by-side preview, and only the owner's Merge writes anything.
 */
export function TgDuplicatesTab({ games, onOpenDetail }: { games: TgGame[]; onOpenDetail: (id: string) => void }) {
  const groups = useMemo(() => findDuplicates(games), [games])
  const [mergeKey, setMergeKey] = useState<string | null>(null)
  const keyOf = (g: DupGroup<TgGame>) => `${g.reason}:${g.key}`
  const open = mergeKey ? groups.find(g => keyOf(g) === mergeKey) ?? null : null

  if (groups.length === 0) return (
    <p className="py-16 text-center text-[14px] tg-muted">No duplicates — no two games share a title or a cover.</p>
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[60rem] text-[13.5px] leading-snug text-[var(--tg-text-2)]">
        {groups.length} possible duplicate{groups.length === 1 ? '' : 's'}, same platform first. A game you own on two platforms shows up too — compare
        before merging. Tap a game to open it.
      </p>
      <ul className="grid grid-cols-1 gap-2 xl:grid-cols-2">
        {groups.map(g => <Group key={keyOf(g)} group={g} onOpenDetail={onOpenDetail} onMerge={() => setMergeKey(keyOf(g))} />)}
      </ul>
      <TgMergeDialog games={open?.games ?? null} onClose={() => setMergeKey(null)} />
    </div>
  )
}
