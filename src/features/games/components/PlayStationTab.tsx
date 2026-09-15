// Placeholder shell — UI only, no backend/DB yet (deliberate, per the user's
// explicit "database için henüz bir şey yapmayalım" request). Sony has NO
// official public PSN API for third-party apps; the only working approach is
// the community-reverse-engineered `npsso` cookie flow (log into
// my.playstation.com, grab the npsso from the ssocookie endpoint, exchange it
// for access/refresh tokens via the `psn-api` library). That's meaningfully
// more fragile than this app's existing Strava/Hevy OAuth integrations — no
// Sony SLA, a reCAPTCHA gate that blocks fully-unattended token refresh (a
// human has to periodically re-paste a fresh npsso), and real coverage gaps
// (no wishlist endpoint, no clean PS Plus status). See the chat record for
// the full research report before wiring this up for real.

const UPCOMING = [
  'Owned games + purchase history',
  'Trophy list per game (bronze/silver/gold/platinum + rarity %)',
  'Recently played + playtime where PSN exposes it',
  'Currently online / what you’re playing right now',
  'Friends list + their online status',
]

export function PlayStationTab() {
  return (
    <div className="max-w-2xl mx-auto text-center py-12 px-4">
      <p className="text-4xl mb-3">🎮</p>
      <h2 className="text-base font-bold text-ink-900 mb-1">PlayStation — not connected yet</h2>
      <p className="text-sm text-ink-500 mb-6">
        Sony has no official public API. Connecting will use the community <code className="text-xs bg-ink-100 px-1 py-0.5 rounded">npsso</code> token
        flow — you'll occasionally need to re-paste a fresh token in Settings when it expires (roughly every couple of months).
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
        🔌 Connect PlayStation (coming soon)
      </button>
      <p className="text-[11px] text-ink-400 mt-3">No account is connected and no data is fetched — this tab is a preview of what's planned.</p>
    </div>
  )
}
