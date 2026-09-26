import type { ReactNode } from 'react'
import type { Tone } from '../../../shared/ui'

/**
 * Centered sign-in card on the canvas, outside the app shell. The frame owns
 * its own scroller: #root is fixed-height, so a tall form on a landscape
 * phone must scroll here rather than in the document.
 */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="flex min-h-full items-center justify-center px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(2rem+env(safe-area-inset-top))]">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-card border border-line bg-surface shadow-card">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-8 w-8" />
            </span>
            <h1 className="text-page font-bold tracking-tight text-fg">{title}</h1>
            {subtitle && <p className="mt-1 text-body text-fg-muted">{subtitle}</p>}
          </div>
          <div className="card flex flex-col gap-4 p-5 sm:p-6">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Inline status message inside an auth card. */
export function AuthNotice({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <p role={tone === 'danger' ? 'alert' : 'status'} data-tone={tone} className="tone-soft tone-text rounded-row px-3 py-2 text-body">
      {children}
    </p>
  )
}
