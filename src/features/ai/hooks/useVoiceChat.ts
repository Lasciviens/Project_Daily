import { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from '../../../app/store'

// Voice chat for the Ask AI panel, built on the browser's own Web Speech API —
// SpeechRecognition (speech → text) + speechSynthesis (text → speech). No key,
// no edge function, no cost: both run in the browser (recognition does send
// audio to the vendor's service, same as any dictation field).
//
// Support is uneven, so EVERY capability is feature-detected and the UI degrades
// instead of breaking:
// - Recognition is Chrome/Edge/Safari-desktop solid, and prefixed
//   (webkitSpeechRecognition) everywhere that has it. It is NOT reliable inside
//   an iOS home-screen PWA — that is what the "AI'a Sor" Shortcut is for on the
//   phone (docs/iphone-examples.md).
// - Synthesis is essentially universal, but iOS refuses to speak unless the
//   audio context was unlocked by a real user gesture first — hence primeAudio().

type Lang = 'tr-TR' | 'en-US'
const LANG_KEY = 'lasci-ai-voice-lang'

// Minimal typings — SpeechRecognition is not in TypeScript's DOM lib.
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
  length: number
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { length: number;[i: number]: SpeechRecognitionResultLike }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function readLang(): Lang {
  try { const v = localStorage.getItem(LANG_KEY); return v === 'en-US' ? 'en-US' : 'tr-TR' }
  catch { return 'tr-TR' }
}

// What the assistant WRITES is not what it should SAY: strip the **bold**
// markers the panel renders visually, drop emoji/symbols (a screen voice
// reading "sparkles" mid-sentence is noise), and collapse the whitespace that
// bullet lists leave behind.
export function speakableText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`#>]/g, ' ')
    // Extended_Pictographic covers emoji properly; the joiner/variation
    // selectors are stripped separately (putting them in one character class
    // is what ESLint's no-misleading-character-class warns about).
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[️‍]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

interface Options {
  /** Fired once per utterance with the final transcript (never empty). */
  onFinalTranscript: (text: string) => void
  /** Fired with each partial result so the UI can show what is being heard. */
  onInterim?: (text: string) => void
}

export function useVoiceChat({ onFinalTranscript, onInterim }: Options) {
  const sttSupported = recognitionCtor() !== null
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const [listening, setListening] = useState(false)
  const [speaking,  setSpeaking]  = useState(false)
  const [lang,      setLangState] = useState<Lang>(readLang)

  const recRef     = useRef<SpeechRecognitionLike | null>(null)
  const finalRef   = useRef('')
  // Callbacks change on every render; keep them in refs so the recognition
  // handlers never capture a stale closure.
  const onFinalRef = useRef(onFinalTranscript)
  const onInterRef = useRef(onInterim)
  const langRef    = useRef(lang)
  useEffect(() => { onFinalRef.current = onFinalTranscript }, [onFinalTranscript])
  useEffect(() => { onInterRef.current = onInterim }, [onInterim])
  useEffect(() => { langRef.current = lang }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try { localStorage.setItem(LANG_KEY, next) } catch { /* quota */ }
  }, [])

  const stopListening = useCallback(() => {
    try { recRef.current?.stop() } catch { /* already stopped */ }
  }, [])

  const startListening = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor) { toast.error('Speech recognition is not available in this browser'); return }
    // Speaking and listening at once would make it transcribe its own voice.
    if (ttsSupported) { window.speechSynthesis.cancel(); setSpeaking(false) }
    try { recRef.current?.abort() } catch { /* none running */ }

    const rec = new Ctor()
    rec.lang = langRef.current
    rec.continuous = false      // one utterance per turn — onend closes the turn
    rec.interimResults = true   // live partial text while the user talks
    rec.maxAlternatives = 1
    finalRef.current = ''

    rec.onstart = () => setListening(true)
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalRef.current += r[0].transcript
        else interim += r[0].transcript
      }
      onInterRef.current?.(finalRef.current + interim)
    }
    rec.onerror = (e) => {
      setListening(false)
      // 'no-speech'/'aborted' are normal outcomes (user said nothing, or we
      // stopped it) — surfacing them as errors would be noise.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast.error('Microphone permission denied')
      } else if (e.error === 'network') {
        toast.error('Speech recognition needs a network connection')
      }
    }
    rec.onend = () => {
      setListening(false)
      const text = finalRef.current.trim()
      finalRef.current = ''
      onInterRef.current?.('')
      if (text) onFinalRef.current(text)
    }

    recRef.current = rec
    try { rec.start() } catch { /* start() throws if already started */ }
  }, [ttsSupported])

  const toggleListening = useCallback(() => {
    if (listening) stopListening(); else startListening()
  }, [listening, startListening, stopListening])

  const cancelSpeak = useCallback(() => {
    if (!ttsSupported) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [ttsSupported])

  // iOS will not speak unless synthesis was first triggered inside a real user
  // gesture. Call this from the tap that turns voice mode on: a zero-length
  // utterance is inaudible but unlocks the queue for later replies.
  const primeAudio = useCallback(() => {
    if (!ttsSupported) return
    try {
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      window.speechSynthesis.speak(u)
    } catch { /* best effort */ }
  }, [ttsSupported])

  /** Speak a reply. `onDone` fires whether it ended, errored, or was cancelled. */
  const speak = useCallback((text: string, onDone?: () => void) => {
    if (!ttsSupported) { onDone?.(); return }
    const clean = speakableText(text)
    if (!clean) { onDone?.(); return }

    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(clean)
    u.lang = langRef.current
    // Voices load asynchronously; an empty list just means "use the default".
    const match = window.speechSynthesis.getVoices().find(v => v.lang === langRef.current)
      ?? window.speechSynthesis.getVoices().find(v => v.lang.startsWith(langRef.current.slice(0, 2)))
    if (match) u.voice = match
    u.rate = 1.02
    let done = false
    const finish = () => { if (done) return; done = true; setSpeaking(false); onDone?.() }
    u.onend = finish
    u.onerror = finish
    setSpeaking(true)
    window.speechSynthesis.speak(u)
  }, [ttsSupported])

  // Never leave the mic hot or a voice talking after the panel/route goes away.
  useEffect(() => () => {
    try { recRef.current?.abort() } catch { /* none */ }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])

  return {
    sttSupported, ttsSupported,
    listening, speaking,
    lang, setLang,
    startListening, stopListening, toggleListening,
    speak, cancelSpeak, primeAudio,
  }
}
