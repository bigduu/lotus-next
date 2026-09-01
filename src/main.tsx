import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { resolveDefaultBrowserRuntimeConfig } from './runtime/browserRuntime.ts'
import { installRuntimeConfig } from './runtime/runtimeConfig.ts'

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

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Lotus Next root element is missing.')
}

const renderBootstrapFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[runtime] Lotus Next bootstrap failed:', error)

  // Runtime installation can fail before React is allowed to mount. Keep this
  // fallback dependency-free and assign error text through textContent.
  const main = document.createElement('main')
  main.className =
    'flex min-h-screen items-center justify-center bg-background p-6 text-foreground'
  const section = document.createElement('section')
  section.className = 'w-full max-w-xl rounded-2xl border bg-card p-6 shadow-lg'
  const heading = document.createElement('h1')
  heading.className = 'text-xl font-semibold'
  heading.textContent = 'Lotus Next 无法启动'
  const explanation = document.createElement('p')
  explanation.className = 'mt-3 text-sm leading-relaxed text-muted-foreground'
  explanation.textContent =
    '当前宿主提供了不受支持或不安全的运行时配置。请升级匹配的完整前端与宿主制品，或修正公开后端地址后重新加载。'
  const details = document.createElement('pre')
  details.className = 'mt-4 overflow-auto rounded-lg bg-muted p-3 text-xs'
  details.textContent = message
  section.append(heading, explanation, details)
  main.append(section)
  rootElement.replaceChildren(main)
}

const bootstrap = async () => {
  // This synchronous installation is the composition boundary: Root and every
  // service singleton are imported only after one immutable runtime exists.
  installRuntimeConfig(resolveDefaultBrowserRuntimeConfig())
  const [{ default: Root }, { default: ErrorBoundary }] = await Promise.all([
    import('./Root.tsx'),
    import('./components/app/ErrorBoundary.tsx'),
  ])

  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary name="Root">
        <Root />
      </ErrorBoundary>
    </StrictMode>,
  )
}

void bootstrap().catch(renderBootstrapFailure)
