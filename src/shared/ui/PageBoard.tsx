import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { cx } from './cx'
import { boardTemplate, resolveBoardLayout, type BoardLayouts } from './pageBoardRules'
import { PageStepContext, usePageStep } from './usePageStep'

// ─────────────────────────────────────────────────────────────────────────────
//  PageBoard — how a page uses a wide screen (THEME.md §6.3, CLAUDE.md →
//  Layout width W7). Cards keep their own caps; the page fills width by adding
//  COLUMNS: one main track (≤ 56rem) plus up to three 24rem side tracks. The
//  step is measured on the board's OWN width (the page's content width, which
//  the sidebar, a collapsed sidebar or a drawer all change), never on the
//  viewport.
//
//  Each step declares which section goes in which column. Columns are stacks
//  (no masonry, no dense packing), so a section's place never depends on its
//  content or on its neighbours' heights.
//
//  Moving a section to another column at a step change remounts it (it loses
//  local state such as an open row). Phones never cross a step; on desktop
//  it only happens while the window is being resized.
// ─────────────────────────────────────────────────────────────────────────────

export interface PageBoardProps<K extends string> {
  /** Every section the page can show, by key. A null/false section renders nothing. */
  sections: Record<K, ReactNode>
  /** Which sections go where, per step (see pageBoardRules.ts). */
  layout: BoardLayouts<K>
  /** Extra classes for the step-1 stack (the phone/tablet column): a cap, `stagger-in`. */
  stackClassName?: string
  /** The step-1 stack's gap (default `gap-3 sm:gap-4`). Wider steps always use 1rem, which the track math assumes. */
  stackGap?: string
  className?: string
}

const STACK = 'flex min-w-0 flex-col'

function Stack<K extends string>({ keys, sections, className, style }: {
  keys: readonly K[]; sections: Record<K, ReactNode>; className?: string; style?: CSSProperties
}) {
  return (
    <div className={cx(STACK, className)} style={style}>
      {keys.map(k => <Fragment key={k}>{sections[k]}</Fragment>)}
    </div>
  )
}

/**
 * ```tsx
 * <PageBoard
 *   sections={{ brief: <DailyBrief />, tasks: <TodayTasksCard />, news: <NewsWidget /> }}
 *   layout={{
 *     1: ['brief', 'tasks', 'news'],
 *     2: { columns: [['brief', 'tasks'], ['news']] },
 *     3: { columns: [{ stack: ['brief'], span: 2 }, { stack: ['news'], sticky: true }], bottom: ['tasks'] },
 *   }}
 * />
 * ```
 */
export function PageBoard<K extends string>({ sections, layout, stackClassName, stackGap = 'gap-3 sm:gap-4', className }: PageBoardProps<K>) {
  const { ref, step } = usePageStep<HTMLDivElement>()
  const resolved = step == null ? null : resolveBoardLayout(layout, step)

  let body: ReactNode = null
  if (resolved && resolved.tracks === 1) {
    body = <Stack keys={resolved.columns[0].stack} sections={sections} className={cx(stackGap, stackClassName)} />
  } else if (resolved) {
    body = (
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: boardTemplate(resolved.tracks, resolved.main) }}>
        {resolved.top.length > 0 && <Stack keys={resolved.top} sections={sections} className="col-span-full gap-4" />}
        {resolved.columns.map((c, i) => (
          <Stack
            key={i}
            keys={c.stack}
            sections={sections}
            className={cx('gap-4', c.sticky && 'sticky top-4 self-start')}
            // Inline so any span works without a safelist.
            style={c.span > 1 ? { gridColumn: `span ${c.span} / span ${c.span}` } : undefined}
          />
        ))}
        {resolved.bottom.length > 0 && <Stack keys={resolved.bottom} sections={sections} className="col-span-full gap-4" />}
      </div>
    )
  }

  return (
    <PageStepContext.Provider value={step ?? 1}>
      <div ref={ref} data-page-step={step ?? undefined} className={cx('w-full min-w-0', className)}>{body}</div>
    </PageStepContext.Provider>
  )
}
