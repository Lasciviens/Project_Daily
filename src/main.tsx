import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { Providers } from './app/providers'

// `immediate: true` checks for an update right away (and periodically after)
// and reloads automatically when one is found — this is what actually makes
// `registerType: 'autoUpdate'` behave as advertised. Without this, updates
// installed but never activated until every tab was closed, so a shipped
// fix could sit invisible behind a stale service worker indefinitely.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
)

