import { useCallback, useEffect, useRef, useState } from 'react'

// Voice for Ask AI, written fresh (the owner's rule, 20.11.2026): the browser's own speech recognition turns speech into
// words, and the words fill the message box for the owner to read, change and send. The app never records, keeps or
// sends sound: only the text that ends up in the box can leave, and only when the owner taps Send. Where the browser has
// no recognizer (Firefox, most desktops), `supported` is false and the button is not drawn. Note for the owner (said in
// Settings and in ai.md): the recognizer belongs to the browser, and the browser's maker may process the sound on its own
// servers (Safari on an iPhone: Apple). Lasci's Board never receives it.

interface RecognitionAlternative { transcript: string }
interface RecognitionResult { readonly length: number; readonly isFinal: boolean; [index: number]: RecognitionAlternative }
interface RecognitionEvent { readonly resultIndex: number; readonly results: { readonly length: number; [index: number]: RecognitionResult } }
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** What went wrong, in a sentence for the owner (null: nothing worth saying, such as silence). */
export function speechProblem(code: string | undefined): string | null {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed': return 'The microphone is not allowed for this site. Allow it in the browser settings to use your voice.'
    case 'audio-capture': return 'No microphone was found.'
    case 'network': return 'The browser could not reach its speech service. Type instead, or try again.'
    case 'language-not-supported': return 'The browser cannot recognise this language.'
    default: return null
  }
}

/**
 * `onText(spoken)` gets everything said in the current listening (it grows while the person talks, and the last call is
 * the final text). The device's language is the recognizer's language.
 */
export function useSpeechInput(onText: (spoken: string) => void): { supported: boolean; listening: boolean; problem: string | null; toggle: () => void; stop: () => void } {
  const [listening, setListening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const ref = useRef<Recognition | null>(null)
  const textRef = useRef(onText)
  useEffect(() => { textRef.current = onText }, [onText])
  const supported = recognitionCtor() !== null

  const stop = useCallback(() => { ref.current?.stop() }, [])
  // Leaving the screen ends the listening.
  useEffect(() => () => { ref.current?.abort() }, [])

  const toggle = useCallback(() => {
    if (ref.current) { ref.current.stop(); return }
    const Ctor = recognitionCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = e => {
      let spoken = ''
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0]?.transcript ?? ''
      textRef.current(spoken)
    }
    rec.onerror = e => { setProblem(speechProblem(e.error)) }
    rec.onend = () => { ref.current = null; setListening(false) }
    setProblem(null)
    ref.current = rec
    try { rec.start(); setListening(true) } catch { ref.current = null; setListening(false) }
  }, [])

  return { supported, listening, problem, toggle, stop }
}
