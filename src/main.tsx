import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'
import ErrorBoundary from './components/app/ErrorBoundary.tsx'

// Vite surfaces a failed dynamic-import preload — a code-split chunk or its CSS
// could not be fetched — as a `vite:preloadError` event. This is typically a
// stale deploy (asset hashes rotated) or a transient CDN/tunnel error (e.g. one
// of many parallel preload requests reset over a Cloudflare tunnel), and shows
// up in the console as "Unable to preload CSS for …" / "Failed to fetch
// dynamically imported module". Left unhandled, the lazy chunk (e.g. the heavy
// mermaid bundle) simply fails to render. Reload once to pull the current
// assets; a short timestamp guard prevents a reload loop if the asset is truly
// gone (then the error is allowed to surface).
let preloadReloadAttempted = false
window.addEventListener('vite:preloadError', (event) => {
  const GUARD_KEY = 'bodhi_preload_reload_at'
  const now = Date.now()
  let last = 0
  try {
    last = Number(window.sessionStorage.getItem(GUARD_KEY) ?? 0)
  } catch {
    last = preloadReloadAttempted ? now : 0
  }
  if (now - last < 10_000) {
    return // already reloaded recently — let it surface instead of looping
  }
  event.preventDefault()
  preloadReloadAttempted = true
  try {
    window.sessionStorage.setItem(GUARD_KEY, String(now))
  } catch {
    // sessionStorage unavailable (private mode): the module flag still guards.
  }
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary name="Root">
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
