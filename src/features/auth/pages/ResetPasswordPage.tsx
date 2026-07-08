import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../integrations/supabase/client'
import { updatePassword } from '../../../security/supabaseClient'

// Public route, outside SessionGuard — only reachable via the recovery link
// Supabase emails (which carries a one-time token in the URL) or by directly
// requesting a reset from LoginPage. Supabase's client processes that token
// on load and fires a PASSWORD_RECOVERY auth event; we also check the current
// session on mount as a fallback in case the event fired before this
// component's listener attached (a real-world flakiness other apps hit).
type Status = 'checking' | 'ready' | 'invalid' | 'success'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [status, setStatus]     = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('ready')
    })

    // Fallback: if the event already fired before we subscribed, a recovery
    // session is still sitting in the client — treat any session found
    // shortly after load on this route as valid (this page is unreachable
    // without a recovery/sign-in token to begin with).
    const timeout = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setStatus(current => (current === 'checking' ? (session ? 'ready' : 'invalid') : current))
    }, 2500)

    return () => {
      listener.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSaving(true)
    const { error } = await updatePassword(password)
    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    setStatus('success')
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Lasci's Board" className="w-12 h-12 mb-3" />
          <h1 className="text-xl font-semibold text-ink-900">Reset password</h1>
        </div>

        <div className="card p-6 flex flex-col gap-4">
          {status === 'checking' && (
            <p className="text-sm text-ink-500 text-center py-4">Verifying link…</p>
          )}

          {status === 'invalid' && (
            <>
              <p className="text-sm text-ink-700">
                This reset link is invalid or has expired. Request a new one from the sign-in page.
              </p>
              <button type="button" onClick={() => navigate('/login')} className="btn-primary w-full">
                Back to sign in
              </button>
            </>
          )}

          {status === 'ready' && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-700">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-700">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input"
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button type="submit" disabled={saving} className="btn-primary w-full mt-1">
                {saving ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}

          {status === 'success' && (
            <>
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                Password updated ✓
              </p>
              <button type="button" onClick={() => navigate('/home')} className="btn-primary w-full">
                Continue
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
