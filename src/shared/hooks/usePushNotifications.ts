import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../integrations/supabase/client'
import { toast } from '../../app/store'

// Web Push subscription lifecycle for the installed PWA. Requests permission,
// subscribes via the browser PushManager with our VAPID public key, and stores
// the subscription in push_subscriptions (owner RLS). The push-send edge
// function later signs a VAPID push to it. iOS only supports this in a
// home-screen-installed PWA (not a Safari tab).
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function usePushNotifications() {
  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setEnabled(!!sub))
      .catch(() => { /* not ready yet */ })
  }, [supported])

  const enable = useCallback(async () => {
    if (!supported) { toast.error('Push notifications are not supported on this device (added as a PWA?)'); return }
    if (!VAPID_PUBLIC) { toast.error('VAPID public key is not configured'); return }
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { toast.error('Notification permission was not granted'); return }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // cast: TS's DOM lib types applicationServerKey as ArrayBufferView<ArrayBuffer>,
        // but a plain Uint8Array is Uint8Array<ArrayBufferLike> — same bytes at runtime.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      })
      const j = sub.toJSON()
      const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: sub.endpoint,
        p256dh: j.keys?.p256dh,
        auth: j.keys?.auth,
        user_agent: navigator.userAgent,
      }, { onConflict: 'user_id,endpoint' })
      if (error) throw error
      setEnabled(true)
      toast.success('Notifications enabled ✓')
    } catch (e) {
      toast.error((e as Error).message ?? 'Could not enable notifications')
    } finally { setBusy(false) }
  }, [supported])

  const disable = useCallback(async () => {
    if (!supported) return
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setEnabled(false)
      toast.success('Notifications turned off')
    } catch (e) {
      toast.error((e as Error).message ?? 'Could not turn off notifications')
    } finally { setBusy(false) }
  }, [supported])

  return { supported, enabled, busy, enable, disable }
}
