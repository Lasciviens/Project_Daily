import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource-variable/inter/wght.css'
import './index.css'
import { Providers } from './app/providers'
import { installIosViewportFix } from './app/iosViewportFix'
import { captureTraktCallback } from './features/media/trakt/traktCallback'

// `immediate: true` checks for an update right away (and periodically after)
// and reloads automatically when one is found — this is what actually makes
// `registerType: 'autoUpdate'` behave as advertised. Without this, updates
// installed but never activated until every tab was closed, so a shipped
// fix could sit invisible behind a stale service worker indefinitely.
registerSW({ immediate: true })
installIosViewportFix()
// Before the router reads the address: Trakt returns to the root with ?code=.
captureTraktCallback()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
)

