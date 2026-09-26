import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updatePassword } from '../../../security/supabaseClient'
import { Button } from '../../../shared/ui'
import { AuthFrame, AuthNotice } from '../components/AuthFrame'
import { usePasswordRecovery } from '../hooks/usePasswordRecovery'

// Public route, outside SessionGuard — only reachable via the recovery link
// Supabase emails (a one-time token in the URL) or a reset requested from
// LoginPage. usePasswordRecovery decides whether that link is still valid.
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const status = usePasswordRecovery()
  const [done, setDone]         = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)

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

    setDone(true)
  }

  return (
    <AuthFrame title="Reset password">
      {done ? (
        <>
          <AuthNotice tone="success">Password updated.</AuthNotice>
          <Button variant="primary" block onClick={() => navigate('/home')}>Continue</Button>
        </>
      ) : status === 'checking' ? (
        <p role="status" className="py-4 text-center text-body text-fg-muted">Verifying link…</p>
      ) : status === 'invalid' ? (
        <>
          <p className="text-body text-fg-2">
            This reset link is invalid or has expired. Request a new one from the sign-in page.
          </p>
          <Button variant="primary" block onClick={() => navigate('/login')}>Back to sign in</Button>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="reset-password" className="field-label">New password</label>
            <input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="input"
            />
          </div>
          <div>
            <label htmlFor="reset-confirm" className="field-label">Confirm password</label>
            <input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              className="input"
            />
          </div>
          {error && <AuthNotice tone="danger">{error}</AuthNotice>}
          <Button type="submit" variant="primary" block loading={saving}>
            {saving ? 'Saving…' : 'Set new password'}
          </Button>
        </form>
      )}
    </AuthFrame>
  )
}
