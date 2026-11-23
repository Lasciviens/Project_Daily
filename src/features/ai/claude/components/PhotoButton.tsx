import { useRef, type ReactNode } from 'react'
import { Camera, Sparkles } from 'lucide-react'
import { Button, IconButton } from '../../../../shared/ui'

/**
 * "Take or pick a photo": a button that opens the phone's camera or photo library (or a file picker) and hands the
 * chosen picture to `onFile`. The photo is shrunk and sent by the caller's hook; nothing is kept here.
 */
/** A camera with a small ✨: the one mark for "this is an AI call" (a photo that is read by the model). */
function CameraAi() {
  return <span className="relative inline-flex"><Camera aria-hidden /><Sparkles aria-hidden className="absolute -right-1.5 -top-1.5 !h-2.5 !w-2.5" /></span>
}

export function PhotoButton({ children, onFile, loading, disabled, icon, variant = 'secondary', className, iconOnly, accept = 'image/*' }: {
  children: ReactNode
  onFile: (file: File) => void
  loading?: boolean
  disabled?: boolean
  icon?: ReactNode
  variant?: 'secondary' | 'ghost' | 'primary'
  className?: string
  /** Only the icon shows (the words stay as its label): for a crowded row. */
  iconOnly?: boolean
  /** What the picker offers: photos by default; a receipt also takes a PDF. */
  accept?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={e => {
          const file = e.target.files?.[0]
          // The same photo may be picked again right after (a retry), so the input is cleared.
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
      {iconOnly ? (
        <IconButton label={String(children)} className={className} disabled={disabled || loading} aria-busy={loading || undefined} onClick={() => input.current?.click()}>{icon ?? <CameraAi />}</IconButton>
      ) : <Button size="sm" variant={variant} className={className} icon={icon ?? <CameraAi />} loading={loading} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </Button>}
    </>
  )
}
