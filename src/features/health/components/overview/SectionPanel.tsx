import { useEffect, useRef, type ReactNode } from 'react'
import { PageBoard, type BoardLayouts } from '../../../../shared/ui'
import { HEALTH_SECTIONS, type HealthSectionId } from '../sectionTypes'

/** The window strip. It scrolls sideways on a phone, so the ACTIVE pill is
 *  kept in view (the edge fade would otherwise cover it). */
export function HealthSectionTabs({ value, onChange }: { value: HealthSectionId; onChange: (id: HealthSectionId) => void }) {
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [value])
  return (
    <div role="tablist" aria-label="Health sections" className="scroll-x -mx-1 flex gap-1 px-1">
      {HEALTH_SECTIONS.map(s => (
        <button
          key={s.id}
          id={`health-tab-${s.id}`}
          type="button"
          role="tab"
          aria-selected={value === s.id}
          aria-controls={`health-panel-${s.id}`}
          ref={value === s.id ? activeRef : undefined}
          onClick={() => onChange(s.id)}
          className="pill-tab shrink-0 gap-1.5 px-3"
        >
          <s.icon className="h-4 w-4" aria-hidden />{s.label}
        </button>
      ))}
    </div>
  )
}

/** One window's content: an optional one-line note, then its cards laid out
 *  by the window's PageBoard (healthBoards.ts): the main chart card in the
 *  main track, trend and timing cards beside it, mini-metric grids after. */
export function SectionPanel<K extends string>({ id, note, sections, layout, stackGap = 'gap-3' }: {
  id: HealthSectionId
  note?: ReactNode
  sections: Record<K, ReactNode>
  layout: BoardLayouts<K>
  stackGap?: string
}) {
  return (
    <section id={`health-panel-${id}`} role="tabpanel" aria-labelledby={`health-tab-${id}`} className="flex min-w-0 flex-col gap-3">
      {note && <p className="text-meta text-fg-muted">{note}</p>}
      <PageBoard sections={sections} layout={layout} stackGap={stackGap} />
    </section>
  )
}
