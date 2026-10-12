import { registerSW } from 'virtual:pwa-register'
import { canApplyUpdate, shouldCheckForUpdate } from './swUpdateRules'

// Registers the service worker and brings in a new version at a quiet
// moment (rules: swUpdateRules.ts). A new version installs in the background
// and waits; the old one keeps serving this page and its code until then, so
// a page left open never asks for a file a deploy removed.
//
// 'update' = a new version is waiting; 'reload' = another tab already put the
// new version in charge, so this page only needs to reload.

let pending: 'update' | 'reload' | null = null
let applying = false
let lastInput = Date.now()
let lastCheck = Date.now()
let registration: ServiceWorkerRegistration | undefined
let applyWaiting: ((reload?: boolean) => Promise<void>) | undefined

function popupOpen(): boolean {
  return document.querySelector('[role="dialog"], [aria-modal="true"]') !== null
}

function typing(): boolean {
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim() !== ''
  return el instanceof HTMLElement && el.isContentEditable && (el.textContent ?? '').trim() !== ''
}

function tryApply() {
  if (!pending || applying) return
  const moment = {
    hidden: document.visibilityState === 'hidden',
    idleMs: Date.now() - lastInput,
    popupOpen: popupOpen(),
    typing: typing(),
  }
  if (!canApplyUpdate(moment)) return
  applying = true
  if (pending === 'reload') window.location.reload()
  // Hands control to the waiting version; the reload follows in onNeedReload.
  else void applyWaiting?.(true)
}

function check(reason: 'interval' | 'visible') {
  if (!registration || !shouldCheckForUpdate(Date.now() - lastCheck, reason)) return
  lastCheck = Date.now()
  registration.update().catch(() => { /* offline: the next check tries again */ })
}

export function installServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  applyWaiting = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = 'update'
      tryApply()
    },
    onNeedReload() {
      if (applying) { window.location.reload(); return }
      pending = 'reload'
      tryApply()
    },
    onRegisteredSW(_url, reg) {
      registration = reg
    },
  })

  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(type, () => { lastInput = Date.now() }, { capture: true, passive: true })
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') tryApply()
    else check('visible')
  })
  // Every minute: an idle page may take a waiting version; a visible one asks
  // the server for a new version every half hour (CHECK_EVERY_MS).
  setInterval(() => {
    tryApply()
    if (document.visibilityState === 'visible') check('interval')
  }, 60 * 1000)

  // The old service worker kept Supabase answers in a cache of their own;
  // nothing reads it any more, so free the space once.
  if (typeof caches !== 'undefined') void caches.delete('supabase-api').catch(() => {})
}
