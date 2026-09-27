import type { ReactNode } from 'react'
import { cx } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { GOAL_SRC, type GoalSourceKey } from './goalSources'

/** One section of the goal report: an eyebrow title with an optional
 *  explanation bubble and action, then its body. */
export function GoalBlock({ title, info, action, children, className }: {
  title: string; info?: ReactNode; action?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={cx('flex min-w-0 flex-col gap-2 rounded-row border border-line p-3', className)}>
      <div className="flex min-h-[28px] items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h4 className="section-label">{title}</h4>
          {info && <InfoBubble label={`About ${title.toLowerCase()}`}>{info}</InfoBubble>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** The studies behind a bubble, as links. */
export function Cites({ keys }: { keys: GoalSourceKey[] }) {
  return (
    <span className="mt-2 flex flex-col gap-1">
      {keys.map(k => (
        <a key={k} href={GOAL_SRC[k].url} target="_blank" rel="noreferrer"
          className="text-micro font-normal leading-snug text-fg-muted underline decoration-line-strong underline-offset-2 hover:text-fg">
          {GOAL_SRC[k].citation}
        </a>
      ))}
    </span>
  )
}
