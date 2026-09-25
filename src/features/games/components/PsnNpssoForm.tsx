import { useState } from 'react'
import { useConnectPsn } from '../hooks/usePlayStation'

// The npsso paste flow, in ONE place so the first-time connect and the
// re-authentication that follows an expired session can never drift apart.
//
// It exists as its own component because re-authenticating is not a rare
// event here: Sony guards its login with a reCAPTCHA, so the cookie behind
// this integration cannot be renewed automatically and has to be pasted again
// every month or two. That makes it the most-repeated action in the feature,
// which is why the steps carry their own links rather than describing where
// to go.
export function PsnNpssoForm({ compact, onConnected }: { compact?: boolean; onConnected?: () => void }) {
  const [npsso, setNpsso] = useState('')
  const connect = useConnectPsn()

  return (
    <div className={compact ? 'text-left' : 'text-left'}>
      <ol className="text-xs text-ink-600 space-y-1 mb-2 list-decimal list-inside">
        <li>
          Log into{' '}
          <a href="https://my.playstation.com" target="_blank" rel="noreferrer"
             className="text-accent-600 underline">my.playstation.com</a>{' '}
          in this browser.
        </li>
        <li>
          Open{' '}
          <a href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noreferrer"
             className="text-accent-600 underline">the ssocookie endpoint</a>{' '}
          — it returns <code className="text-[11px] bg-ink-100 px-1 rounded">{'{"npsso":"…"}'}</code>.
        </li>
        <li>Paste the value between the quotes below.</li>
      </ol>
      <textarea
        value={npsso}
        onChange={e => setNpsso(e.target.value)}
        rows={2}
        placeholder="Paste your npsso token here…"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none"
      />
      <button
        type="button"
        onClick={() => connect.mutate(npsso.trim(), {
          onSuccess: () => { setNpsso(''); onConnected?.() },
        })}
        disabled={!npsso.trim() || connect.isPending}
        className="mt-2 min-h-[44px] px-4 text-sm font-semibold rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-40"
      >
        {connect.isPending ? 'Connecting…' : '🔌 Connect'}
      </button>
    </div>
  )
}
