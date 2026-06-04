import { useGoogleLogin } from '@react-oauth/google'
import { useCalendarStore } from '../../../app/store'

export function CalendarConnect() {
  const { accessToken, setAccessToken } = useCalendarStore()

  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    onSuccess: ({ access_token }) => setAccessToken(access_token),
    onError:   () => console.error('Google login failed'),
  })

  if (accessToken) {
    return (
      <button
        onClick={() => setAccessToken(null)}
        className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-700 transition-colors duration-150"
        title="Disconnect Google Calendar"
      >
        <span className="w-2 h-2 rounded-full bg-green-400" />
        Calendar
      </button>
    )
  }

  return (
    <button
      onClick={() => login()}
      className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent-600 transition-colors duration-150"
      title="Connect Google Calendar"
    >
      <span className="w-2 h-2 rounded-full bg-ink-200" />
      Calendar
    </button>
  )
}
