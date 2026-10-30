import { supabase } from '../integrations/supabase/client'
import { useCalendarStore } from '../app/store'
import { SERIES_PENDING_KEY } from '../features/calendar/calendarSeries'
import { forgetCalendarPrefs } from '../features/calendar/areas/calendarPrefsMemory'

// What signing out must leave behind (security audit 10.10.2026). Before this,
// sign-out only ended the Supabase session: the Google token, the AI chat, the
// cached API answers and this device's morning-brief subscription all stayed,
// so the next account in this browser inherited them and the brief kept coming.
// Drafts (Dev Requests, a Shop chain being built, the Diary's unsaved words) stay on purpose — nothing
// typed is ever lost, and a session that expires lands here too.

// Kept here as text so the shell doesn't load the Games code; the verify script
// checks the stores still use these names.
const IGDB_BATCH_KEY = 'lasci.igdbBatch'
const AUTO_SYNC_PREFIX = 'lasci.games.autoSync.'

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
  // The Google calendars picked: their ids name the account (the main one is its address).
  try { useCalendarStore.getState().setSelectedCalendarIds(null) } catch { /* */ }
  try { localStorage.removeItem('lasci-ai-chat') } catch { /* */ }
  try { localStorage.removeItem('lasci.googleTasks.warnedError') } catch { /* */ }
  // Repeating-plan Calendar pushes waiting for a retry (they name this account's plans).
  try { localStorage.removeItem(SERIES_PENDING_KEY) } catch { /* */ }
  // Which areas are on Apple Calendar (the Google calls' copy of Settings → Calendar).
  try { forgetCalendarPrefs() } catch { /* */ }
  // Games: the IGDB review list (this account's games) and the daily auto-sync marks.
  try { localStorage.removeItem(IGDB_BATCH_KEY) } catch { /* */ }
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    for (const k of keys) if (k?.startsWith(AUTO_SYNC_PREFIX)) localStorage.removeItem(k)
  } catch { /* */ }
  // The device copy of the body goals stays: it can be the only copy until
  // they are saved to the account (DayTargetsEditor), and a session that just
  // expired also lands here.
  // The service worker's runtime caches (vite.config.ts): weather URLs carry
  // the location, transit URLs the stop searches. 'supabase-api' is gone from
  // the config but may linger on an older install.
  try {
    if (typeof caches !== 'undefined') {
      await Promise.all(['weather-api', 'transit-api', 'tmdb-images', 'supabase-api'].map(name => caches.delete(name)))
    }
  } catch { /* */ }
}
