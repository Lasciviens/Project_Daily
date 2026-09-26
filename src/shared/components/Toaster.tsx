import { CheckCircle2, XCircle, AlertTriangle, Info, LoaderCircle, type LucideIcon } from 'lucide-react'
import { useToastStore, type Toast } from '../../app/store'
import type { Tone } from '../ui'

const TONE: Record<Toast['type'], Tone> = {
  success: 'success',
  error: 'danger',
  warning: 'warn',
  info: 'info',
  loading: 'accent',
}

const ICON: Record<Toast['type'], LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  loading: LoaderCircle,
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore(s => s.dismiss)
  const Icon = ICON[toast.type]
  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      data-tone={TONE[toast.type]}
      onClick={() => dismiss(toast.id)}
      className="flex w-full min-w-[220px] cursor-pointer select-none items-center gap-2.5 rounded-row border border-line bg-surface py-2.5 pl-3 pr-3.5 text-body font-medium text-fg shadow-menu sm:w-auto sm:max-w-[360px]"
    >
      <span className="tone-soft grid h-7 w-7 shrink-0 place-items-center rounded-full">
        <Icon className={`tone-text h-4 w-4 ${toast.type === 'loading' ? 'animate-spin' : ''}`} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="flex-1 leading-snug">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); toast.action!.onClick() }}
          className="-my-1 ml-1 min-h-[40px] shrink-0 rounded-control px-3 font-semibold text-accent-600 [@media(hover:hover)]:hover:bg-surface-hover [@media(pointer:coarse)]:min-h-[44px]"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

const DEFAULT_POSITION = 'bottom-6 left-4 sm:left-6'

/** `positionClassName` replaces the default bottom-left offsets — the app
 *  shell lifts it above the phone tab bar; full-screen pages pass their own. */
export function Toaster({ positionClassName = DEFAULT_POSITION }: { positionClassName?: string } = {}) {
  const toasts = useToastStore(s => s.toasts)
  if (!toasts.length) return null

  return (
    <div aria-live="polite" className={`pointer-events-none fixed z-toast flex flex-col items-start gap-2 ${positionClassName}`}>
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto w-full animate-[fadeSlideIn_0.2s_ease-out] sm:w-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  )
}
