// Web Push handlers, imported into the Workbox-generated service worker via
// vite.config's workbox.importScripts. Shows the notification on `push` and
// focuses/opens the app on click. Paths are resolved against the SW scope
// (…/Project_Daily/) so they work under the GitHub Pages base.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_e) { d = {}; }
  const title = d.title || "Lasci's Board";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: self.registration.scope + 'logo.svg',
    badge: self.registration.scope + 'favicon.svg',
    data: { url: d.url || '#/home' },
    tag: d.tag || 'lascis',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rel = (event.notification.data && event.notification.data.url) || '#/home';
  const target = self.registration.scope + rel;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if ('focus' in c) { try { await c.navigate(target); } catch (_e) { /* cross-origin guard */ } return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
