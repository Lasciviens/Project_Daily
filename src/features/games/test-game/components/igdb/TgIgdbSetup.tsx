import { ExternalLink } from 'lucide-react'
import { TgScrapeCard } from '../scrape/TgScrapeParts'

/** Shown until the igdb-api function has its Twitch app credentials. */
export function TgIgdbSetup({ error }: { error?: string | null }) {
  return (
    <TgScrapeCard title="Connect IGDB (one time, about 10 minutes)">
      <p className="text-[13px] leading-relaxed">
        IGDB belongs to Twitch, so it uses a free Twitch developer app instead of an API key. You make the app once;
        the server then gets its own access token from it and renews it by itself.
      </p>
      <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-relaxed">
        <li>Sign in at <a href="https://dev.twitch.tv/console" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--tg-accent)]">dev.twitch.tv/console <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a> with a Twitch account. Twitch asks you to turn on two-factor authentication first.</li>
        <li><b>Register Your Application</b>: any name, OAuth Redirect URL <code className="rounded bg-[var(--tg-panel-2)] px-1">http://localhost</code>, category <b>Application Integration</b>, client type <b>Confidential</b>.</li>
        <li>Open the app (Manage), copy the <b>Client ID</b>, then press <b>New Secret</b> and copy the <b>Client Secret</b> (Twitch shows it once).</li>
        <li>In Supabase → Edge Functions → Secrets add <code className="rounded bg-[var(--tg-panel-2)] px-1">IGDB_CLIENT_ID</code> and <code className="rounded bg-[var(--tg-panel-2)] px-1">IGDB_CLIENT_SECRET</code>.</li>
        <li>Apply migration <b>121</b> and deploy the <b>igdb-api</b> function, then come back here.</li>
      </ol>
      <p className="mt-3 text-[12px] tg-muted">Never paste the secret into the app or a chat — it only goes into Supabase.</p>
      {error && <p className="mt-2 text-[12.5px] text-[var(--tg-red)]">{error}</p>}
    </TgScrapeCard>
  )
}
