// Stands in for @supabase/realtime-js (vite.config.ts aliases it here). The app uses no Realtime, the live table
// updates over a WebSocket. Still, supabase-js builds a RealtimeClient in its constructor, so realtime-js
// (16 kB gzip) came with every page's first download. The client calls only these methods; on its own it calls
// only setAuth, on every sign-in and token refresh. verify-realtime-stub checks the list against the installed
// supabase-js. To use Realtime one day, remove the alias and this file.
export class RealtimeClient {
  setAuth(): Promise<void> { return Promise.resolve() }
  channel(): never { throw new Error('Realtime is not part of this app (src/integrations/supabase/realtimeStub.ts)') }
  getChannels(): [] { return [] }
  removeChannel(): Promise<'ok'> { return Promise.resolve('ok') }
  removeAllChannels(): Promise<[]> { return Promise.resolve([]) }
}
