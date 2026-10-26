import { supabase } from '../integrations/supabase/client'
import { useCalendarStore } from '../app/store'
import { SERIES_PENDING_KEY } from '../features/calendar/calendarSeries'
import { LOCAL_GOALS_KEY } from '../features/health/goal/goalSettings'

// What signing out must leave behind (security audit 10.10.2026). Before this,
// sign-out only ended the Supabase session: the Google token, the AI chat, the
// cached API answers and this device's morning-brief subscription all stayed,
// so the next account in this browser inherited them and the brief kept coming.
// Drafts (Dev Requests) stay on purpose — nothing typed is ever lost.

const PUSH_LOOKUP_MS = 3000

/** Stops the morning brief for this device. Runs while the session still works. */
export async function forgetThisDevicePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => setTimeout(() => resolve(null), PUSH_LOOKUP_MS)),
    ])
    const sub = reg ? await reg.pushManager.getSubscription() : null
    // The browser keeps its subscription, so signing in again re-registers it
    // (refreshThisDevicePush re-stamps the row on the next app start).
    if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  } catch { /* never blocks sign-out */ }
}

/**
 * Re-stamps this device's subscription row on every app start (last_seen_at,
 * and the current login session — migration 140 stamps it from the JWT), so a
 * signed-in device keeps its brief and one that signs back in gets it again.
 */
export async function refreshThisDevicePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => setTimeout(() => resolve(null), PUSH_LOOKUP_MS)),
    ])
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (!sub) return
    const j = sub.toJSON()
    if (!j.keys?.p256dh || !j.keys?.auth) return
    await supabase.from('push_subscriptions').upsert({
      endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent,
    }, { onConflict: 'user_id,endpoint' })
  } catch { /* best effort */ }
}

/** Clears state that belongs to the account that just signed out. */
export async function clearAccountState(): Promise<void> {
  try { useCalendarStore.getState().setAccessToken(null) } catch { /* */ }
  try { localStorage.removeItem('lasci-ai-chat') } catch { /* */ }
  try { localStorage.removeItem('lasci.googleTasks.warnedError') } catch { /* */ }
  // Repeating-plan Calendar pushes waiting for a retry (they name this account's plans).
  try { localStorage.removeItem(SERIES_PENDING_KEY) } catch { /* */ }
  // The old fallback copy of the goal weight / body fat goal.
  try { localStorage.removeItem(LOCAL_GOALS_KEY) } catch { /* */ }
  // The service worker's runtime caches (vite.config.ts): weather URLs carry
  // the location, transit URLs the stop searches. 'supabase-api' is gone from
  // the config but may linger on an older install.
  try {
    if (typeof caches !== 'undefined') {
      await Promise.all(['weather-api', 'transit-api', 'tmdb-images', 'supabase-api'].map(name => caches.delete(name)))
    }
  } catch { /* */ }
}
