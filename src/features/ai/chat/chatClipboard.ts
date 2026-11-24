import { toast } from '../../../app/store'

/** Plain text to the clipboard: the browser's own way, else a hidden text box (older iOS). Says how it went. */
export function copyText(text: string) {
  const fallback = () => {
    try {
      const box = document.createElement('textarea')
      box.value = text
      box.setAttribute('readonly', '')
      box.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(box)
      box.select()
      box.setSelectionRange(0, text.length)
      const done = document.execCommand('copy')
      box.remove()
      if (done) toast.success('Copied')
      else toast.error('Copy failed')
    } catch { toast.error('Copy failed') }
  }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast.success('Copied'), fallback)
  else fallback()
}
