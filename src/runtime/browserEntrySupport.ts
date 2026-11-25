import { isClaimedLocalPreloadError, isLocalFeaturePreloadError, mayBeLocalWebKitPreloadError } from "./preloadErrorPolicy"

export function installAssetRecovery() {
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
  const reloadAfterFailure = (event?: Event) => {
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
    event?.preventDefault()
    preloadReloadAttempted = true
    try {
      window.sessionStorage.setItem(GUARD_KEY, String(now))
    } catch {
      // sessionStorage unavailable (private mode): the module flag still guards.
    }
    window.location.reload()
  }
  window.addEventListener('vite:preloadError', (event) => {
    const { payload } = event as Event & { payload?: unknown }
    if (isLocalFeaturePreloadError(payload)) return
    if (mayBeLocalWebKitPreloadError(payload)) {
      // WebKit omits the failed URL. Let the local import catch claim this
      // exact error before deciding whether the app still needs to reload.
      window.setTimeout(() => {
        if (!isClaimedLocalPreloadError(payload)) reloadAfterFailure()
      }, 0)
      return
    }
    reloadAfterFailure(event)
  })
}

export function renderBootstrapFailure(rootElement: HTMLElement, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[runtime] Lotus Next bootstrap failed:', error)

  // Runtime installation can fail before the UI mounts. Keep this
  // fallback dependency-free and assign error text through textContent.
  const main = document.createElement('main')
  main.className =
    'flex min-h-screen items-center justify-center bg-background p-6 text-foreground'
  const section = document.createElement('section')
  section.className = 'w-full max-w-xl rounded-2xl border bg-card p-6 shadow-lg'
  const heading = document.createElement('h1')
  heading.className = 'text-xl font-semibold'
  let failureLocale = window.navigator.language
  try {
    failureLocale = window.localStorage.getItem('lotus_ui_locale_v1') || failureLocale
  } catch { /* Bootstrap failure must work even when storage is blocked. */ }
  const chinese = failureLocale.toLowerCase().startsWith('zh')
  heading.textContent = chinese ? 'Lotus Next 无法启动' : 'Lotus Next could not start'
  const explanation = document.createElement('p')
  explanation.className = 'mt-3 text-sm leading-relaxed text-muted-foreground'
  explanation.textContent =
    chinese
      ? '当前宿主提供了不受支持或不安全的运行时配置。请升级匹配的完整前端与宿主制品，或修正公开后端地址后重新加载。'
      : 'The host supplied unsupported or unsafe runtime configuration. Upgrade the matching frontend and host artifacts, or correct the public backend address and reload.'
  const details = document.createElement('pre')
  details.className = 'mt-4 overflow-auto rounded-lg bg-muted p-3 text-xs'
  details.textContent = message
  section.append(heading, explanation, details)
  main.append(section)
  rootElement.replaceChildren(main)
}
