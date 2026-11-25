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

export function PhotoButton({ children, onFile, onFiles, multiple, loading, disabled, icon, variant = 'secondary', className, iconOnly, bordered, accept = 'image/*', tip }: {
  children: ReactNode
  onFile?: (file: File) => void
  /** With `multiple`: every file picked at once, in the order the picker gave them. The caller limits and checks them. */
  onFiles?: (files: File[]) => void
  multiple?: boolean
  loading?: boolean
  disabled?: boolean
  icon?: ReactNode
  variant?: 'secondary' | 'ghost' | 'primary'
  className?: string
  /** Only the icon shows (the words stay as its label): for a crowded row. */
  iconOnly?: boolean
  /** With `iconOnly`: the bordered icon button (beside other bordered ones, the link row's Scan). */
  bordered?: boolean
  /** What the picker offers: photos by default; a receipt also takes a PDF. */
  accept?: string
  /** The full description of a short label (title, accessible name, long press on touch). */
  tip?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={e => {
          const files = Array.from(e.target.files ?? [])
          // The same photo may be picked again right after (a retry), so the input is cleared.
          e.target.value = ''
          if (multiple && onFiles) { if (files.length) onFiles(files) } else if (files[0]) onFile?.(files[0])
        }}
      />
      {iconOnly ? (
        <IconButton label={tip ?? String(children)} bordered={bordered} className={className} disabled={disabled || loading} aria-busy={loading || undefined} onClick={() => input.current?.click()}>{icon ?? <CameraAi />}</IconButton>
      ) : <Button size="sm" variant={variant} className={className} icon={icon ?? <CameraAi />} loading={loading} disabled={disabled} tip={tip} onClick={() => input.current?.click()}>
        {children}
      </Button>}
    </>
  )
}
