// Placeholder shell — UI only, no backend/DB yet (deliberate, per the user's
// explicit "database için henüz bir şey yapmayalım" request). Steam's Web
// API is far more stable than PSN's: a personal API key from
// steamcommunity.com/dev/apikey + your own SteamID64 (no OAuth needed for
// read-only public profile data — the "Sign in through Steam" OpenID flow
// only proves identity, it grants no extra access). Must still be proxied
// through a Supabase Edge Function — api.steampowered.com sends no CORS
// headers, so a direct browser fetch is blocked. See the chat record for
// the full research report before wiring this up for real.

const UPCOMING = [
  'Owned games + total playtime per game',
  'Recently played (last 2 weeks) + trend',
  'Achievement completion % per game',
  'Currently online / what you’re playing right now',
  'Steam level, badges, friends list',
  'Genres/tags/Metacritic score per game (store metadata)',
]

export function SteamTab() {
  return (
    <div className="max-w-2xl mx-auto text-center py-12 px-4">
      <p className="text-4xl mb-3">🖥️</p>
      <h2 className="text-base font-bold text-ink-900 mb-1">Steam — not connected yet</h2>
      <p className="text-sm text-ink-500 mb-6">
        Connecting will use a personal Steam Web API key + your SteamID64 — a one-time setup, no recurring reconnect needed
        (unlike PlayStation). All calls run server-side; your key never reaches the browser.
      </p>

      <div className="text-left bg-cream-50 border border-ink-200 rounded-xl p-4 mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">What this will show once connected</p>
        <ul className="space-y-1.5">
          {UPCOMING.map(item => (
            <li key={item} className="text-sm text-ink-700 flex items-start gap-2">
              <span className="text-ink-300 mt-0.5">•</span><span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <button disabled
        className="min-h-[44px] px-5 text-sm font-semibold bg-ink-200 text-ink-400 rounded-xl cursor-not-allowed">
        🔌 Connect Steam (coming soon)
      </button>
      <p className="text-[11px] text-ink-400 mt-3">No account is connected and no data is fetched — this tab is a preview of what's planned.</p>
    </div>
  )
}
