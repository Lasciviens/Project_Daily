import { useState, type ReactNode } from 'react'
import { Dices, Plus } from 'lucide-react'
import { AddGameModal } from '../../components/AddGameModal'
import { useTestGameStore } from '../testGameStore'
import { ALL_PLATFORMS, OTHER_PLATFORMS, platformInfo, type TgGame } from '../testGameModel'
import type { TgRandomScope } from '../advancedTabs'

function ToolCard({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--tg-border)] bg-[var(--tg-panel-2)] p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]">{icon}</span>
        <h3 className="text-[15px] font-semibold text-[var(--tg-text)]">{title}</h3>
      </div>
      <p className="text-[13px] leading-relaxed tg-muted">{text}</p>
      <div className="mt-auto">{children}</div>
    </div>
  )
}

function poolText(n: number, { platform, search, genre }: TgRandomScope): string {
  const where = platform === ALL_PLATFORMS ? 'in your library'
    : platform === OTHER_PLATFORMS ? 'on Other Platforms'
    : `on ${platformInfo(platform).name}`
  const q = search.trim()
  const narrowed = [q && `matching “${q}”`, genre && `in ${genre}`].filter(Boolean).join(' ')
  return `Picks one of the ${n} game${n === 1 ? '' : 's'} ${where}${narrowed ? ` ${narrowed}` : ''} (the Library's current shelf) and opens its full details.`
}

/** The current page's header buttons: "＋ Add game" and "🎲 Random". */
export function TgAdvancedViewTools({ onOpenDetail, randomPool, scope }: {
  onOpenDetail: (id: string) => void
  randomPool: TgGame[]
  scope: TgRandomScope
}) {
  const [addOpen, setAddOpen] = useState(false)
  const n = randomPool.length
  const narrowed = scope.search.trim() !== '' || scope.genre != null
  const clearFilters = () => { const s = useTestGameStore.getState(); s.setSearch(''); s.setGenre(null) }

  function pickRandom() {
    if (!n) return
    onOpenDetail(randomPool[Math.floor(Math.random() * n)].id)
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
      <ToolCard icon={<Plus size={20} strokeWidth={2} />} title="Add game"
        text="Add a game by hand — title, platform, status, tier, cover art and every other field the library keeps.">
        <button type="button" className="tg-btn tg-btn-primary w-full sm:w-auto" onClick={() => setAddOpen(true)}>
          <Plus size={17} strokeWidth={2} />Add game
        </button>
      </ToolCard>

      <ToolCard icon={<Dices size={20} strokeWidth={2} />} title="Random pick" text={poolText(n, scope)}>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tg-btn tg-btn-secondary w-full sm:w-auto" onClick={pickRandom} disabled={!n}>
            <Dices size={17} strokeWidth={2} />Random pick
          </button>
          {narrowed && (
            <button type="button" className="tg-btn tg-btn-secondary w-full sm:w-auto" onClick={clearFilters}>
              Clear search &amp; genre
            </button>
          )}
        </div>
      </ToolCard>

      <AddGameModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}
