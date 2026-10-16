import { useState, type ReactNode } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Sparkles } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, MetaLine, Truncate, cx } from '../../../shared/ui'
import { chipClass, choiceClass } from '../../../shared/components/plan-modal/fieldStyles'
import {
  choiceHint, factorLabel, GUESS_FACTORS, noPicks, pickedFactor, pickedGuess, togglePick,
  type GuessMacros, type GuessPicks, type GuessPreset,
} from '../quickGuess'

/** What the ask logs: one one-off line. */
export interface AskedGuess extends GuessMacros { title: string }

interface AskProps {
  preset: GuessPreset
  /** The card's ½–2 switch when the ask opened. */
  factor: number
  /** "dinner" — where the line goes. */
  slotName: string
  onLog: (g: AskedGuess) => void
  /** "Describe it instead…" with what was picked as the text to start from. */
  onDescribe: (text: string) => void
}

function useAsk(preset: GuessPreset, initialFactor: number) {
  const groups = preset.options ?? []
  const [picks, setPicks] = useState<GuessPicks>(() => noPicks(groups))
  const [factor, setFactor] = useState(initialFactor)
  return {
    groups, picks, factor, setFactor,
    result: pickedGuess(preset, picks, factor),
    mult: pickedFactor(groups, picks, factor),
    pick: (gi: number, ci: number) => setPicks(p => togglePick(groups, p, gi, ci)),
  }
}
type Ask = ReturnType<typeof useAsk>

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Truncate className="max-w-[6.5rem] pt-1.5 text-meta font-medium text-fg-muted">{label}</Truncate>
      <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
    </>
  )
}

/** The rows: the ½–2 switch, then each option group as chips; then the total. */
function AskRows({ ask }: { ask: Ask }) {
  const ownSize = ask.groups.some(g => g.pick === 'size')
  const r = ask.result
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
        <Row label={ownSize ? 'Portions' : 'Size'}>
          {GUESS_FACTORS.map(f => (
            <button key={f} type="button" aria-pressed={ask.factor === f} onClick={() => ask.setFactor(f)}
              className={choiceClass(ask.factor === f, 'min-w-10', 'sm')}>{factorLabel(f)}</button>
          ))}
        </Row>
        {ask.groups.map((g, gi) => (
          <Row key={gi} label={g.name}>
            {g.choices.map((c, ci) => {
              const on = (ask.picks[gi] ?? []).includes(ci)
              const hint = choiceHint(c, g.pick, ask.mult)
              return (
                <button key={ci} type="button" aria-pressed={on} onClick={() => ask.pick(gi, ci)}
                  title={g.pick === 'any' ? 'Pick any' : 'Pick one'} className={choiceClass(on, undefined, 'sm')}>
                  <Truncate className="min-w-0">{c.name}</Truncate>
                  {hint && <span className={cx('text-micro font-normal', on ? 'text-on-accent/80' : 'text-fg-muted')}>{hint}</span>}
                </button>
              )
            })}
          </Row>
        ))}
      </div>
      <MetaLine className="text-body tabular-nums text-fg-2"
        items={[<strong key="k" className="font-semibold text-fg">= {r.kcal} kcal</strong>, `${r.protein} g protein`, `${r.carbs} g carbs`, `${r.fat} g fat`]} />
    </div>
  )
}

function describeText(ask: Ask, preset: GuessPreset): string {
  return preset.portion ? `${ask.result.title} (1 portion = ${preset.portion})` : ask.result.title
}

function AskFooter({ ask, preset, onLog, onDescribe }: { ask: Ask; preset: GuessPreset; onLog: () => void; onDescribe: (text: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button type="button" onClick={() => onDescribe(describeText(ask, preset))} className={chipClass('quiet', '-ml-1.5')}
        title="Type what you had: the AI estimates it and you check the numbers before logging">
        <Sparkles aria-hidden /> Describe it instead… <span className="text-fg-faint">AI</span>
      </button>
      <Button size="sm" variant="primary" onClick={onLog}>Log {ask.result.kcal} kcal</Button>
    </div>
  )
}

const portionLine = (preset: GuessPreset, slotName: string) =>
  [preset.portion && `1 portion = ${preset.portion}`, `logs to ${slotName}`].filter(Boolean).join(' · ')

/** The phone's ask: a bottom sheet (ModalShell). */
export function GuessAskSheet({ onClose, ...props }: AskProps & { onClose: () => void }) {
  const { preset, slotName, onLog, onDescribe } = props
  const ask = useAsk(preset, props.factor)
  return (
    <ModalShell onClose={onClose} size="sm" compact title={preset.title} subtitle={portionLine(preset, slotName)}
      footer={<AskFooter ask={ask} preset={preset} onLog={() => { onLog(ask.result); onClose() }} onDescribe={t => { onClose(); onDescribe(t) }} />}>
      <AskRows ask={ask} />
    </ModalShell>
  )
}

function AskPanel({ close, ...props }: AskProps & { close: () => void }) {
  const { preset, slotName, onLog, onDescribe } = props
  const ask = useAsk(preset, props.factor)
  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <p className="text-body font-semibold text-fg">{preset.title}</p>
        <p className="text-meta text-fg-muted">{portionLine(preset, slotName)}</p>
      </div>
      <AskRows ask={ask} />
      <div className="border-t border-line pt-2.5">
        <AskFooter ask={ask} preset={preset} onLog={() => { onLog(ask.result); close() }} onDescribe={t => { close(); onDescribe(t) }} />
      </div>
    </div>
  )
}

/** The wider screens' ask: a popover under the chip (Headless UI Popover). */
export function GuessAskPopover({ buttonClassName, buttonTitle, children, ...props }: AskProps & { buttonClassName: string; buttonTitle: string; children: ReactNode }) {
  return (
    <Popover className="relative min-w-0">
      <PopoverButton className={cx(buttonClassName, 'w-full')} title={buttonTitle}>{children}</PopoverButton>
      <PopoverPanel anchor="bottom start" className="z-popover w-[min(26rem,calc(100vw-24px))] rounded-menu border border-line-strong bg-surface p-3 shadow-menu [--anchor-gap:6px] [--anchor-padding:8px]">
        {({ close }) => <AskPanel {...props} close={close} />}
      </PopoverPanel>
    </Popover>
  )
}
