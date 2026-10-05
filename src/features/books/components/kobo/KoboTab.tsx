import type { ComponentType } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LayoutDashboard, ListTree, MessageCircleQuestion, Moon, SlidersHorizontal } from 'lucide-react'
import { Card, PageBoard, cx, useBoardStep } from '../../../../shared/ui'
import { KOBO_BOARD } from '../../booksBoard'
import { AskedCard } from './AskedCard'
import { ChangedSettingsCard } from './ChangedSettingsCard'
import { KoboDeviceCard } from './KoboDeviceCard'
import { KoboSettingsCard } from './KoboSettingsCard'
import { MenuOrderCard } from './MenuOrderCard'
import { SleepScreenCard } from './SleepScreenCard'
import { StorageCard } from './StorageCard'

export type KoboSection = 'overview' | 'sleep' | 'settings' | 'menus' | 'asked'

const SECTIONS: { id: KoboSection; label: string; hint: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', hint: 'Battery, storage, last sync', icon: LayoutDashboard },
  { id: 'sleep', label: 'Sleep screen', hint: 'Cover, your images, message', icon: Moon },
  { id: 'settings', label: 'Settings', hint: 'Every KOReader setting, explained', icon: SlidersHorizontal },
  { id: 'menus', label: 'Menu order', hint: 'Reorder KOReader’s menus', icon: ListTree },
  { id: 'asked', label: 'Asked on the Kobo', hint: 'Answers to your questions', icon: MessageCircleQuestion },
]

/** Control the Kobo from the app, one section at a time. */
export function KoboTab() {
  const [params, setParams] = useSearchParams()
  const section: KoboSection = SECTIONS.some(s => s.id === params.get('section')) ? params.get('section') as KoboSection : 'overview'
  const go = (id: KoboSection) => setParams(p => { p.set('section', id); p.delete('area'); return p })
  return (
    <PageBoard layout={KOBO_BOARD} stackGap="gap-4" sections={{
      nav: <KoboNav section={section} onSelect={go} />,
      content: <SectionBody section={section} onSelect={go} />,
    }} />
  )
}

function KoboNav({ section, onSelect }: { section: KoboSection; onSelect: (id: KoboSection) => void }) {
  const step = useBoardStep()
  if (step === 1) {
    return (
      <nav aria-label="Kobo sections" className="scroll-x -mx-4 flex gap-1.5 px-4">
        {SECTIONS.map(s => (
          <button key={s.id} type="button" aria-pressed={section === s.id} onClick={() => onSelect(s.id)} className="pill-tab shrink-0">
            <s.icon className="h-4 w-4" aria-hidden />{s.label}
          </button>
        ))}
      </nav>
    )
  }
  return (
    <Card padded={false} className="p-2">
      <nav aria-label="Kobo sections" className="flex flex-col gap-0.5">
        {SECTIONS.map(s => {
          const active = section === s.id
          return (
            <button key={s.id} type="button" aria-current={active ? 'page' : undefined} onClick={() => onSelect(s.id)}
              className={cx('flex min-h-[52px] items-center gap-3 rounded-row px-3 py-2 text-left transition-colors',
                active ? 'bg-accent-50 text-fg' : 'text-fg-2 hover:bg-surface-hover')}>
              <span aria-hidden className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-control',
                active ? 'bg-accent-500 text-on-accent' : 'bg-surface-2 text-fg-muted')}>
                <s.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-body font-semibold">{s.label}</span>
                <span className="block text-micro text-fg-muted">{s.hint}</span>
              </span>
            </button>
          )
        })}
      </nav>
    </Card>
  )
}

function SectionBody({ section, onSelect }: { section: KoboSection; onSelect: (id: KoboSection) => void }) {
  if (section === 'sleep') return <SleepScreenCard />
  if (section === 'settings') return <KoboSettingsCard />
  if (section === 'menus') return <MenuOrderCard />
  if (section === 'asked') return <AskedCard />
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-4 @[52rem]:grid-cols-2">
        <KoboDeviceCard />
        <StorageCard />
        <ChangedSettingsCard onOpenSettings={() => onSelect('settings')} />
      </div>
    </div>
  )
}
