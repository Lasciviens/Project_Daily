import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Card, IconButton, MetaLine, TonePill, Truncate } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import type { Usage } from '../foodLibraryModel'
import { MacroBar } from './MacroBar'
import { FoodThumb } from './foodLogKit'

export interface LibraryCardMacros {
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  /** g protein per 100 kcal (null without calories). */
  density: number | null
  high: boolean
}

/**
 * One Library item, goal first (owner, 13.10.2026): name, then kcal and
 * protein for what + logs, protein per 100 kcal (green when high protein),
 * carbs / fat and when you last ate it — three short lines, the P/C/F split
 * as a strip on the bottom edge. The card opens the item; + is a sibling
 * button, never inside it.
 */
export function LibraryCard({ title, imageUrl, group, macros, meta, usage, onOpen, onLog, logLabel }: {
  title: string
  imageUrl?: string | null
  group?: string | null
  /** null: no calories yet. */
  macros: LibraryCardMacros | null
  /** The quiet last line's first facts (carbs / fat, the portion); usage follows. */
  meta: (ReactNode | false | null | undefined)[]
  /** Times eaten in the usage window and the last day. */
  usage?: Usage
  onOpen: () => void
  onLog: () => void
  logLabel: string
}) {
  const facts = [...meta, ...(usage ? [`${usage.count}×`, `last ${formatDate(usage.lastDate)}`] : ['not eaten lately'])]
  return (
    <Card as="article" padded={false} className="relative overflow-hidden">
      <button type="button" onClick={onOpen} className="press-feedback flex w-full items-start gap-2.5 p-2.5 pb-3 text-left">
        <FoodThumb name={title} group={group} imageUrl={imageUrl} size={44} />
        <span className="min-w-0 flex-1">
          <Truncate lines={2} className="pr-8 text-body font-semibold leading-snug text-fg">{title}</Truncate>
          {macros ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 tabular-nums">
              <span className="whitespace-nowrap"><strong className="text-ui font-semibold text-fg">{macros.kcal == null ? '–' : Math.round(macros.kcal)}</strong> <span className="text-meta text-fg-muted">kcal</span></span>
              <span className="whitespace-nowrap"><strong className="text-ui font-semibold text-fg">{macros.protein == null ? '–' : Math.round(macros.protein)} g</strong> <span className="text-meta text-fg-muted">protein</span></span>
              {macros.density != null && (
                <span title={`${macros.density} g protein per 100 kcal${macros.high ? ' — high protein' : ''}`}>
                  <TonePill tone={macros.high ? 'success' : 'neutral'}>{macros.density} g / 100 kcal</TonePill>
                </span>
              )}
            </span>
          ) : (
            <TonePill tone="warn" className="mt-1">No macros yet</TonePill>
          )}
          <MetaLine as="span" className="mt-0.5 block text-micro leading-snug text-fg-muted tabular-nums" items={facts} />
        </span>
      </button>
      <IconButton label={logLabel} onClick={onLog} className="absolute right-1 top-1 text-accent-600"><Plus /></IconButton>
      {macros && (
        <div className="absolute inset-x-0 bottom-0">
          <MacroBar protein={macros.protein} carbs={macros.carbs} fat={macros.fat} showLegend={false} barClassName="h-1" />
        </div>
      )}
    </Card>
  )
}
