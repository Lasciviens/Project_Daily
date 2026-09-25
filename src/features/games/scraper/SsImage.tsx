import { useEffect, useRef, useState, type ReactNode } from 'react'
import { loadProxied, peekProxied } from './ssImageQueue'

type LoadState = 'loading' | 'ready' | 'missing' | 'failed'

/**
 * An image that may come through the ScreenScraper proxy. Proxied images load
 * only once they scroll near the viewport, a few at a time (ssImageQueue);
 * any other URL (a stored copy) is a plain lazy <img>.
 */
export function SsImage({ src, proxied, alt = '', className = '', imgClassName = '', fallback = null }: {
  src: string | null
  proxied: boolean
  alt?: string
  className?: string
  imgClassName?: string
  fallback?: ReactNode
}) {
  const box = useRef<HTMLSpanElement>(null)
  // What the queue answered for THIS src; a new src starts over (it is part of
  // the state, so no effect has to reset anything).
  const [loaded, setLoaded] = useState<{ src: string; url: string | null; state: LoadState } | null>(null)
  const [decoded, setDecoded] = useState<{ url: string; ok: boolean } | null>(null)

  const peek = src && proxied ? peekProxied(src) : undefined
  const current = loaded?.src === src ? loaded : null
  const url = !src ? null : !proxied ? src : current?.url ?? (peek && 'url' in peek ? peek.url : null)
  const queueState: LoadState = !src ? 'missing' : !proxied ? 'loading' : current?.state ?? (peek ? ('url' in peek ? 'ready' : peek.error) : 'loading')
  const imgState = url && decoded?.url === url ? (decoded.ok ? 'ready' : 'failed') : null
  const state: LoadState = queueState === 'missing' || queueState === 'failed' ? queueState : imgState ?? (url ? 'loading' : queueState)

  useEffect(() => {
    if (!src || !proxied || peekProxied(src)) return
    let alive = true
    const start = () => loadProxied(src).then(r => {
      if (alive) setLoaded({ src, url: 'url' in r ? r.url : null, state: 'url' in r ? 'ready' : r.error })
    })
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') { start(); return () => { alive = false } }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); start() }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [src, proxied])

  return (
    <span ref={box} className={`relative block ${className}`}>
      {url && state !== 'missing' && state !== 'failed' && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setDecoded({ url, ok: true })}
          onError={() => setDecoded({ url, ok: false })}
          className={`${imgClassName} ${state === 'ready' ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
        />
      )}
      {state !== 'ready' && fallback}
    </span>
  )
}
