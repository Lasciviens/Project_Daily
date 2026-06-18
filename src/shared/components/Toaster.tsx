import { useToastStore, type Toast } from '../../app/store'

const STYLES: Record<Toast['type'], string> = {
  success: 'bg-green-600 text-white',
  error:   'bg-red-600 text-white',
  loading: 'bg-ink-800 text-white',
  info:    'bg-ink-700 text-white',
  warning: 'bg-yellow-500 text-white',
}

const ICON: Record<Toast['type'], string> = {
  success: '✓',
  error:   '✕',
  loading: '…',
  info:    'ℹ',
  warning: '⚠',
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore(s => s.dismiss)
  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium min-w-[220px] max-w-[340px] cursor-pointer select-none ${STYLES[toast.type]}`}
      onClick={() => dismiss(toast.id)}
    >
      <span className={`text-base leading-none flex-shrink-0 ${toast.type === 'loading' ? 'animate-spin inline-block' : ''}`}>
        {ICON[toast.type]}
      </span>
      <span className="leading-snug">{toast.message}</span>
    </div>
  )
}

export function Toaster() {
  const toasts = useToastStore(s => s.toasts)
  if (!toasts.length) return null

  return (
    <div className="fixed bottom-6 left-4 sm:left-6 z-[9999] flex flex-col gap-2 items-start pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto animate-[fadeSlideIn_0.2s_ease-out]">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  )
}
