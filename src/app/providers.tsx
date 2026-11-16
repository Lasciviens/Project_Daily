import { useEffect, useState } from 'react'
import { IsRestoringProvider, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { Router } from './router'
import { applyStoredTheme } from './store'
import { STALE } from '../shared/query'
import { startQueryPersistence } from '../shared/query/persist'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE.default,
      // An answer nobody is looking at stays a day, so the device copy (persist.ts) holds the pages opened
      // lately and not only the one on screen when the app closed. The copy itself drops what is a week old.
      gcTime: STALE.day,
      retry: 1,
    },
  },
})

// The last answers this device kept are put back before the first page draws (shared/query/persist.ts).
let answersIn = false
const answersRestored = startQueryPersistence(queryClient).then(() => { answersIn = true })

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

export function Providers() {
  useEffect(() => { applyStoredTheme() }, [])
  // Reads wait for the kept answers (at most a moment): a page then draws with them instead of asking first.
  const [restoring, setRestoring] = useState(!answersIn)
  useEffect(() => { void answersRestored.then(() => setRestoring(false)) }, [])

  const app = (
    <QueryClientProvider client={queryClient}>
      <IsRestoringProvider value={restoring}>
        <Router />
      </IsRestoringProvider>
    </QueryClientProvider>
  )

  // GoogleOAuthProvider only wraps when client ID is configured
  if (!GOOGLE_CLIENT_ID) return app

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {app}
    </GoogleOAuthProvider>
  )
}
