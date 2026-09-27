import type { ReactNode } from 'react'

// One section of the Health page: an anchor target for the jump row, a
// heading, and its cards stacked in a column capped at the chart width (W4).
export function PageSection({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 scroll-mt-4 flex-col gap-3">
      <div>
        <h2 id={`${id}-title`} className="text-lead font-semibold text-fg">{title}</h2>
        {subtitle && <p className="text-meta text-fg-muted">{subtitle}</p>}
      </div>
      <div className="flex w-full max-w-4xl flex-col gap-3">{children}</div>
    </section>
  )
}
