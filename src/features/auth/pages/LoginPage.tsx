import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { signIn, requestPasswordReset } from '../../../security/supabaseClient'
import { Button } from '../../../shared/ui'
import { AuthFrame, AuthNotice } from '../components/AuthFrame'

export function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [notice, setNotice]     = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  function switchMode(next: 'signin' | 'forgot') {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await signIn(email, password)

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    navigate('/')
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)

    const { error } = await requestPasswordReset(email)
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setNotice('If an account exists for that email, a reset link has been sent.')
  }

  const emailField = (
    <div>
      <label htmlFor="login-email" className="field-label">Email</label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        className="input"
      />
    </div>
  )

  if (mode === 'forgot') {
    return (
      <AuthFrame title="Reset password" subtitle="We'll email you a reset link">
        <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
          {emailField}
          {error && <AuthNotice tone="danger">{error}</AuthNotice>}
          {notice && <AuthNotice tone="success">{notice}</AuthNotice>}
          <Button type="submit" variant="primary" block loading={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </Button>
          <Button variant="ghost" icon={<ArrowLeft />} onClick={() => switchMode('signin')}>
            Back to sign in
          </Button>
        </form>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title="Lasci's Board" subtitle="Sign in to your board">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {emailField}
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="field-label">Password</label>
            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className="mb-1.5 min-h-[32px] text-meta font-semibold text-accent-600 hover:text-accent-700 [@media(pointer:coarse)]:min-h-[44px]"
            >
              Forgot password?
            </button>
          </div>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="input"
          />
        </div>
        {error && <AuthNotice tone="danger">{error}</AuthNotice>}
        <Button type="submit" variant="primary" block loading={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthFrame>
  )
}
