import { routeLabel, type PageContext } from '../devRequestContext'

/** "Attach page context" — what gets appended on save, and the switch for it. */
export function PageContextToggle({ start, checked, onChange }: {
  start: PageContext | null
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-row px-1 text-meta text-fg-muted [@media(pointer:coarse)]:min-h-[44px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-accent-500"
      />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-fg-2">Attach page context</span>
        {start && (
          <span className="block truncate">
            {routeLabel(start)} · {start.viewport.w}×{start.viewport.h} {start.breakpoint}
          </span>
        )}
      </span>
    </label>
  )
}
