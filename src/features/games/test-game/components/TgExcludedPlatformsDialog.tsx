import { useState } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button } from '../../../../shared/ui'
import { useGamesPrefs } from '../../prefs/useGamesPrefs'
import { platformInfo, type PlatformGroup } from '../testGameModel'
import { PlatformIcon } from './platformArt'
import { useTgPlatformPrefs } from './tgPlatformPrefs'

/**
 * Platforms left out of every count, stat and batch (synced, migration 133).
 * Their games stay in the Library. A draft until Save.
 */
export function TgExcludedPlatformsDialog({ groups }: { groups: PlatformGroup[] }) {
  const open = useTgPlatformPrefs(s => s.open)
  const setOpen = useTgPlatformPrefs(s => s.setOpen)
  if (!open) return null
  return <Dialog groups={groups} onClose={() => setOpen(false)} />
}

function Dialog({ groups, onClose }: { groups: PlatformGroup[]; onClose: () => void }) {
  const { prefs, loaded, save } = useGamesPrefs()
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const picked = draft ?? new Set(prefs.excludedPlatforms)
  const toggle = (key: string) => {
    const next = new Set(picked)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setDraft(next)
  }
  // A left-out platform with no games any more stays listed so it can be put back.
  const known = new Set(groups.flatMap(g => g.platforms.map(p => p.key)))
  const orphans = prefs.excludedPlatforms.filter(k => !known.has(k))
  const leftOutGames = groups.reduce((n, g) => n + g.platforms.reduce((m, p) => m + (picked.has(p.key) ? p.count : 0), 0), 0)
  const changed = draft != null && [...draft].sort().join('|') !== prefs.excludedPlatforms.join('|')

  async function onSave() {
    try { await save.mutateAsync({ excludedPlatforms: [...picked] }) } catch { return }
    onClose()
  }

  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      panelClassName="tg-portal tg-legacy"
      title="Platforms left out of stats"
      subtitle="Their games stay in your Library"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta text-fg-muted tabular-nums">
            {picked.size ? `${picked.size} platform${picked.size === 1 ? '' : 's'} · ${leftOutGames.toLocaleString('en-GB')} game${leftOutGames === 1 ? '' : 's'}` : 'Nothing left out'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!loaded || !changed} loading={save.isPending} onClick={() => { void onSave() }}>Save</Button>
          </div>
        </div>
      }
    >
      <p className="mb-3 text-meta text-fg-muted">
        Left out of game counts, Analytics, Needs review, Duplicates, the ScreenScraper and IGDB batches, the random pick and the Home tile — on every device. You can still open and edit them.
      </p>
      <div className="flex flex-col gap-3">
        {groups.map(g => (
          <section key={g.maker}>
            <h3 className="mb-1 text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">{g.label}</h3>
            <div className="divide-y divide-line overflow-hidden rounded-row border border-line">
              {g.platforms.map(p => (
                <Row key={p.key} k={p.key} name={p.info.name} family={p.info.family} count={p.count} on={picked.has(p.key)} onToggle={toggle} />
              ))}
            </div>
          </section>
        ))}
        {orphans.length > 0 && (
          <section>
            <h3 className="mb-1 text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">No games now</h3>
            <div className="divide-y divide-line overflow-hidden rounded-row border border-line">
              {orphans.map(k => {
                const info = platformInfo(k)
                return <Row key={k} k={k} name={info.name} family={info.family} count={0} on={picked.has(k)} onToggle={toggle} />
              })}
            </div>
          </section>
        )}
      </div>
    </ModalShell>
  )
}

function Row({ k, name, family, count, on, onToggle }: {
  k: string; name: string; family: Parameters<typeof PlatformIcon>[0]['family']; count: number; on: boolean; onToggle: (k: string) => void
}) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 transition-colors hover:bg-surface-hover">
      <input type="checkbox" checked={on} onChange={() => onToggle(k)} className="h-4 w-4 shrink-0 accent-accent-500" />
      <PlatformIcon family={family} className="h-[18px] w-[18px] shrink-0 text-fg-muted" />
      <span className={`min-w-0 flex-1 truncate text-body ${on ? 'text-fg-muted line-through decoration-fg-faint' : 'text-fg'}`}>{name}</span>
      <span className="text-meta text-fg-muted tabular-nums">{count.toLocaleString('en-GB')}</span>
    </label>
  )
}
