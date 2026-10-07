import { useMemo, useState } from 'react'
import { AlertTriangle, Ban, Info } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Truncate } from '../../../../shared/ui/Truncate'
import { useSetPlayStatus } from '../../hooks/useGames'
import { useMergeGames } from '../../hooks/useMergeGames'
import { playSeconds, type TgGame } from '../testGameModel'
import { planMerge, type MergeNote } from '../tgMergeModel'
import { TgCover } from './TgCover'
import { TgConfirmDialog } from './TgConfirmDialog'
import { LIBRARY_LABEL, compareRows, dupMeta, mergedGame } from './tgMergeFormat'

interface Props {
  /** The duplicate group being compared; null closes the popup. */
  games: TgGame[] | null
  onClose: () => void
}

/** Starting choice: keep the retro copy with the most play time (it carries the most history). */
function defaultPair(games: TgGame[]): [string, string] {
  const ranked = [...games].sort((a, b) =>
    Number(b.library === 'retro') - Number(a.library === 'retro') || (playSeconds(b) ?? 0) - (playSeconds(a) ?? 0))
  return [ranked[0].id, ranked[1].id]
}

const NOTE_ICON = { block: Ban, warn: AlertTriangle, info: Info }
const NOTE_TONE: Record<MergeNote['level'], string> = {
  block: 'border-[var(--tg-red)] text-[var(--tg-text)]',
  warn: 'border-[var(--tg-star)] text-[var(--tg-text)]',
  info: 'border-[var(--tg-border)] text-[var(--tg-text-2)]',
}

function Choice({ game, role, onKeep, onMerge, canMergeIn }: {
  game: TgGame; role: 'keep' | 'drop' | null; onKeep: () => void; onMerge: () => void; canMergeIn: boolean
}) {
  const pill = (active: boolean) =>
    `min-h-[36px] rounded-lg px-3 text-[13px] font-semibold [@media(pointer:coarse)]:min-h-[44px] ${active ? 'bg-[var(--tg-accent)] text-[var(--tg-on-accent)]' : 'border border-[var(--tg-border)] text-[var(--tg-text-2)] [@media(hover:hover)]:hover:bg-[var(--tg-hover)]'}`
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-2.5 ${role === 'keep' ? 'border-[var(--tg-accent)] bg-[var(--tg-accent-soft)]' : 'border-[var(--tg-border)]'}`}>
      <span className="block h-14 w-10 shrink-0 overflow-hidden rounded"><TgCover game={game} mode="contain" /></span>
      <span className="min-w-0 flex-1">
        <Truncate className="text-[14px] font-semibold text-[var(--tg-text)]">{game.title}</Truncate>
        <Truncate className="text-[12.5px] text-[var(--tg-muted)]">{dupMeta(game)}</Truncate>
      </span>
      <span className="flex shrink-0 flex-col gap-1 sm:flex-row">
        <button type="button" aria-pressed={role === 'keep'} onClick={onKeep} className={pill(role === 'keep')}>Keep</button>
        {canMergeIn && <button type="button" aria-pressed={role === 'drop'} onClick={onMerge} className={pill(role === 'drop')}>Merge in</button>}
      </span>
    </div>
  )
}

/**
 * Compare & merge: the duplicate copies side by side, the owner picks the one
 * to keep, and the popup shows the result BEFORE anything is written (the
 * same rules the database applies — tgMergeModel / migration 131). Steam and
 * PlayStation copies can't be merged (their sync would add the copy back);
 * the popup offers hiding instead.
 */
export function TgMergeDialog({ games, onClose }: Props) {
  const open = games != null && games.length >= 2
  const groupKey = games?.map(g => g.id).join('|') ?? ''
  const [pair, setPair] = useState<{ key: string; keep: string; drop: string } | null>(null)
  const current = pair && pair.key === groupKey && games?.some(g => g.id === pair.keep) && games.some(g => g.id === pair.drop)
    ? pair
    : open ? (() => { const [keep, drop] = defaultPair(games); return { key: groupKey, keep, drop } })() : null
  const keep = games?.find(g => g.id === current?.keep) ?? null
  const drop = games?.find(g => g.id === current?.drop) ?? null
  const [confirm, setConfirm] = useState(false)
  const merge = useMergeGames()
  const hide = useSetPlayStatus()

  const plan = useMemo(() => (keep && drop ? planMerge(keep, drop) : null), [keep, drop])
  const rows = useMemo(() => (keep && drop && plan ? compareRows(keep, drop, mergedGame(keep, drop, plan.merged)) : []), [keep, drop, plan])

  function pickKeep(id: string) {
    if (!current) return
    const nextDrop = id === current.drop ? current.keep : current.drop
    setPair({ key: groupKey, keep: id, drop: nextDrop })
  }
  function pickDrop(id: string) {
    if (current && id !== current.keep) setPair({ key: groupKey, keep: current.keep, drop: id })
  }

  const busy = merge.isPending || hide.isPending
  const footer = plan && keep && drop && (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" onClick={onClose} className="tg-btn tg-btn-secondary">Cancel</button>
      {plan.offerHide && drop.play_status !== 'hidden' && (
        <button type="button" disabled={busy} onClick={() => hide.mutate({ id: drop.id, status: 'hidden' }, { onSuccess: onClose })} className="tg-btn tg-btn-secondary">
          Hide the {LIBRARY_LABEL[drop.library] ?? drop.library} copy
        </button>
      )}
      <button type="button" disabled={!!plan.blocked || busy} onClick={() => setConfirm(true)} className="tg-btn tg-btn-primary disabled:opacity-50">
        Merge
      </button>
    </div>
  )

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Compare & merge"
      subtitle={keep?.title}
      size="xl"
      mobile="fullscreen"
      dismissible={!merge.isPending}
      footer={footer || undefined}
      panelClassName="tg-portal !border-[var(--tg-border)] !bg-[var(--tg-panel)] text-[var(--tg-text)] sm:!max-w-[min(64rem,calc(100vw-2rem))]"
    >
      {plan && keep && drop && (
        <div className="@container flex flex-col gap-4">
          <section aria-label="Which copy to keep" className="flex flex-col gap-2">
            <p className="text-[13.5px] text-[var(--tg-text-2)]">
              Pick the copy to keep. The other one is merged into it and removed; its title never replaces the kept one.
            </p>
            <div className="grid grid-cols-1 gap-2 @[44rem]:grid-cols-2">
              {games!.map(g => (
                <Choice
                  key={g.id} game={g}
                  role={g.id === keep.id ? 'keep' : g.id === drop.id ? 'drop' : null}
                  canMergeIn={games!.length > 2 && g.id !== keep.id}
                  onKeep={() => pickKeep(g.id)} onMerge={() => pickDrop(g.id)}
                />
              ))}
            </div>
          </section>

          {plan.notes.length > 0 && (
            <ul aria-label="Checks" className="flex flex-col gap-1.5">
              {plan.notes.map(n => {
                const Icon = NOTE_ICON[n.level]
                return (
                  <li key={n.text} className={`flex gap-2 rounded-lg border-l-[3px] border-y border-r bg-[var(--tg-panel-2)] px-3 py-2 text-[13px] leading-snug ${NOTE_TONE[n.level]}`}>
                    <Icon aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${n.level === 'block' ? 'text-[var(--tg-red)]' : n.level === 'warn' ? 'text-[var(--tg-star)]' : 'tg-muted'}`} />
                    <span>{n.text}</span>
                  </li>
                )
              })}
            </ul>
          )}

          <section aria-label="Result" className="flex flex-col">
            <div className="hidden grid-cols-[8.5rem_repeat(3,minmax(0,1fr))] gap-x-3 border-b border-[var(--tg-border)] pb-1.5 text-[11.5px] font-semibold uppercase tracking-wide tg-muted @[40rem]:grid">
              <span>Field</span><span>Kept</span><span>Merged in</span><span>Result</span>
            </div>
            <dl>
              {rows.map(r => (
                <div key={r.label} className="grid grid-cols-3 gap-x-3 border-b border-[var(--tg-border)] py-1.5 text-[13px] leading-snug @[40rem]:grid-cols-[8.5rem_repeat(3,minmax(0,1fr))]">
                  <dt className="col-span-3 text-[12px] font-semibold tg-muted @[40rem]:col-span-1 @[40rem]:text-[13px] @[40rem]:font-normal">{r.label}</dt>
                  <dd className="min-w-0 break-words text-[var(--tg-text-2)]"><span className="tg-muted @[40rem]:hidden">Kept: </span>{r.keep}</dd>
                  <dd className="min-w-0 break-words text-[var(--tg-text-2)]"><span className="tg-muted @[40rem]:hidden">In: </span>{r.drop}</dd>
                  <dd className={`min-w-0 break-words ${r.changed ? 'font-semibold text-[var(--tg-green)]' : 'text-[var(--tg-text)]'}`}>
                    <span className="font-normal tg-muted @[40rem]:hidden">→ </span>{r.result}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[12px] tg-muted">Changed values are highlighted. Nothing is written until you press Merge.</p>
          </section>
        </div>
      )}
      <TgConfirmDialog
        open={confirm}
        title="Merge these games?"
        message={keep && drop ? `"${drop.title}" (${dupMeta(drop)}) is merged into "${keep.title}" and removed. This can't be undone.` : undefined}
        confirmLabel="Merge"
        onClose={() => setConfirm(false)}
        onConfirm={() => { if (keep && drop) merge.mutate({ keepId: keep.id, dropId: drop.id }, { onSuccess: onClose }) }}
      />
    </ModalShell>
  )
}
