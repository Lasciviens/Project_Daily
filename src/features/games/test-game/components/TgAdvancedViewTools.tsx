import { useState, type ReactNode } from 'react'
import { Dices, Plus } from 'lucide-react'
import { AddGameModal } from '../../components/AddGameModal'
import type { TgGame } from '../testGameModel'

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

/** The current page's header buttons: "＋ Add game" and "🎲 Random". */
export function TgAdvancedViewTools({ onOpenDetail, randomPool }: { onOpenDetail: (id: string) => void; randomPool: TgGame[] }) {
  const [addOpen, setAddOpen] = useState(false)
  const n = randomPool.length

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

      <ToolCard icon={<Dices size={20} strokeWidth={2} />} title="Random pick"
        text={`Picks from the ${n} game${n === 1 ? '' : 's'} on the current shelf and opens its full details.`}>
        <button type="button" className="tg-btn tg-btn-secondary w-full sm:w-auto" onClick={pickRandom} disabled={!n}>
          <Dices size={17} strokeWidth={2} />Random pick
        </button>
      </ToolCard>

      <AddGameModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}
