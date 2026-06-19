import { useState } from 'react'

interface Props {
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
  loading?: boolean
}

export function MediaSection({ title, count, defaultOpen = true, children, loading }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 mb-3 w-full text-left group min-h-[44px]"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          {title}
        </span>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-ink-100 text-ink-500">
            {count}
          </span>
        )}
        <span className={`ml-auto text-ink-400 text-xs transition-transform duration-150 ${open ? 'rotate-0' : '-rotate-90'}`}>
          ▾
        </span>
      </button>

      {open && (
        <div>
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-lg bg-cream-200 animate-pulse" />
              ))}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}
