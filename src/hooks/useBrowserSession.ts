import { useCallback, useEffect, useRef, useState } from "react"
import { isApiError, RequestCancelledError } from "@services/api"
import { browserService } from "@services/browser/BrowserService"
import { matchesActiveBrowserPage } from "@/lib/browserFrame"
import type {
  BrowserDomSnapshot,
  BrowserFrame,
  BrowserHistoryDirection,
  BrowserInput,
  BrowserScreenshot,
  BrowserState,
  BrowserViewport,
} from "@services/browser/types"

export interface DisplayedBrowserFrame extends BrowserFrame {
  objectUrl: string
}

type Scope = {
  sessionId: string
  controller: AbortController
}

const userMessage = (error: unknown): string => {
  if (isApiError(error)) {
    if (error.status === 404) return "当前 Bamboo 尚未提供内置浏览器。"
    if (error.status === 409) return "网页已重新启动，状态已刷新；请重试操作。"
    if (error.status === 503) return "浏览器运行时暂不可用，请稍后重试。"
  }
  return "浏览器暂时无法使用，请重试。"
}

export function useBrowserSession(sessionId: string | null, active: boolean) {
  const [state, setState] = useState<BrowserState | null>(null)
  const [frame, setFrame] = useState<DisplayedBrowserFrame | null>(null)
  const [dom, setDom] = useState<BrowserDomSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [domLoading, setDomLoading] = useState(false)
  const [screenshotLoading, setScreenshotLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryVersion, setRetryVersion] = useState(0)
  const scopeRef = useRef<Scope | null>(null)
  const stateRef = useRef<BrowserState | null>(null)
  const stateVersionRef = useRef(0)
  const mutationVersionRef = useRef(0)
  const framePollResetRef = useRef(0)
  const frameSuspendedRef = useRef(false)
  const actionQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  const publishState = useCallback((next: BrowserState) => {
    const previous = stateRef.current
    if (previous && next.page_epoch < previous.page_epoch) return
    if (previous && (
      previous.page_epoch !== next.page_epoch ||
      previous.active_tab_id !== next.active_tab_id ||
      previous.url !== next.url
    )) {
      mutationVersionRef.current += 1
      setDom(null)
      setFrame(null)
    }
    stateRef.current = next
    stateVersionRef.current += 1
    setState(next)
  }, [])

  useEffect(() => {
    return () => {
      if (frame) URL.revokeObjectURL(frame.objectUrl)
    }
  }, [frame])

  useEffect(() => {
    scopeRef.current?.controller.abort()
    scopeRef.current = null
    stateRef.current = null
    mutationVersionRef.current += 1
    framePollResetRef.current += 1
    frameSuspendedRef.current = false
    actionQueueRef.current = Promise.resolve()
    setState(null)
    setFrame(null)
    setDom(null)
    setError(null)
    setBusy(false)
    setDomLoading(false)
    setScreenshotLoading(false)
    setLoading(Boolean(sessionId && active))
    if (!sessionId || !active) return

    const controller = new AbortController()
    const scope: Scope = { sessionId, controller }
    scopeRef.current = scope
    const isCurrent = () => scopeRef.current === scope && !controller.signal.aborted

    const run = async () => {
      const initial = await browserService.open(sessionId, controller.signal)
      if (!isCurrent()) return
      publishState(initial)
      setLoading(false)

      let after = 0
      let observedEpoch = initial.page_epoch
      let observedTabId = initial.active_tab_id
      let observedReset = framePollResetRef.current
      let lastStateRefresh = Date.now()
      while (isCurrent()) {
        if (frameSuspendedRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          continue
        }
        if (stateRef.current && (
          stateRef.current.page_epoch !== observedEpoch ||
          stateRef.current.active_tab_id !== observedTabId ||
          framePollResetRef.current !== observedReset
        )) {
          observedEpoch = stateRef.current.page_epoch
          observedTabId = stateRef.current.active_tab_id
          observedReset = framePollResetRef.current
          after = 0
          setFrame(null)
        }
        const requestReset = framePollResetRef.current
        const next = await browserService.frame(sessionId, after, 1500, controller.signal)
        if (!isCurrent()) return
        if (requestReset !== framePollResetRef.current || frameSuspendedRef.current) {
          after = 0
          setFrame(null)
          continue
        }
        if (stateRef.current && (
          stateRef.current.page_epoch !== observedEpoch ||
          stateRef.current.active_tab_id !== observedTabId ||
          framePollResetRef.current !== observedReset
        )) {
          observedEpoch = stateRef.current.page_epoch
          observedTabId = stateRef.current.active_tab_id
          observedReset = framePollResetRef.current
          after = 0
          setFrame(null)
        }
        if (next && !matchesActiveBrowserPage(next, stateRef.current)) {
          const version = stateVersionRef.current
          const refreshed = await browserService.get(sessionId, controller.signal)
          if (!isCurrent()) return
          if (version === stateVersionRef.current) {
            publishState(refreshed)
          }
          observedEpoch = stateRef.current?.page_epoch ?? observedEpoch
          observedTabId = stateRef.current?.active_tab_id
          observedReset = framePollResetRef.current
          setFrame(null)
          if (!matchesActiveBrowserPage(next, stateRef.current)) {
            // Frame sequence is session-monotonic. Wait past this stale JPEG
            // instead of immediately fetching the same frame in a hot loop.
            after = Math.max(after, next.frame_seq)
            continue
          }
        }
        if (next && matchesActiveBrowserPage(next, stateRef.current) && next.frame_seq > after) {
          after = next.frame_seq
          const objectUrl = URL.createObjectURL(next.blob)
          if (!isCurrent()) {
            URL.revokeObjectURL(objectUrl)
            return
          }
          setFrame({ ...next, objectUrl })
        }
        // The agent can navigate while this tab is open. Keep the address and
        // history controls in sync with that same Bamboo page.
        if (Date.now() - lastStateRefresh >= 2000) {
          lastStateRefresh = Date.now()
          const version = stateVersionRef.current
          const refreshed = await browserService.get(sessionId, controller.signal)
          if (!isCurrent()) return
          if (version === stateVersionRef.current) {
            publishState(refreshed)
          }
        }
      }
    }

    void run().catch((cause: unknown) => {
      if (!isCurrent() || cause instanceof RequestCancelledError) return
      setError(userMessage(cause))
      setLoading(false)
    })

    return () => {
      controller.abort()
      if (scopeRef.current === scope) scopeRef.current = null
    }
  }, [sessionId, active, retryVersion, publishState])

  const perform = useCallback(
    (
      action: (scope: Scope, expectedEpoch: number) => Promise<BrowserState>,
      invalidateDom = true,
      invalidateFrame = false,
      markBusy = true,
    ): Promise<void> => {
      const scope = scopeRef.current
      if (!scope || !stateRef.current) return Promise.resolve()

      const task = actionQueueRef.current.catch(() => undefined).then(async () => {
        if (scopeRef.current !== scope || scope.controller.signal.aborted) return
        const expectedEpoch = stateRef.current?.page_epoch
        if (expectedEpoch === undefined) return
        if (invalidateDom) {
          mutationVersionRef.current += 1
          setDom(null)
        }
        if (invalidateFrame) {
          frameSuspendedRef.current = true
          framePollResetRef.current += 1
          setFrame(null)
        }
        if (markBusy) setBusy(true)
        try {
          const next = await action(scope, expectedEpoch)
          if (scopeRef.current !== scope || scope.controller.signal.aborted) return
          publishState(next)
          setError(null)
        } catch (cause) {
          if (scopeRef.current !== scope || scope.controller.signal.aborted) return
          if (isApiError(cause) && cause.status === 409) {
            try {
              const refreshed = await browserService.get(scope.sessionId, scope.controller.signal)
              if (scopeRef.current === scope) {
                publishState(refreshed)
              }
            } catch {
              // The original conflict remains the actionable failure.
            }
          }
          setError(userMessage(cause))
        } finally {
          if (invalidateFrame && scopeRef.current === scope) {
            frameSuspendedRef.current = false
            framePollResetRef.current += 1
          }
          if (markBusy && scopeRef.current === scope) setBusy(false)
        }
      })
      actionQueueRef.current = task
      return task
    },
    [publishState],
  )

  const navigate = useCallback(
    (url: string) => perform((scope, epoch) => browserService.navigate(scope.sessionId, url, epoch)),
    [perform],
  )
  const history = useCallback(
    (direction: BrowserHistoryDirection) =>
      perform((scope, epoch) => browserService.history(scope.sessionId, direction, epoch)),
    [perform],
  )
  const viewport = useCallback(
    (size: BrowserViewport) =>
      perform((scope, epoch) => browserService.viewport(scope.sessionId, size, epoch), false, false, false),
    [perform],
  )
  const input = useCallback(
    (event: BrowserInput) =>
      perform((scope, epoch) => browserService.input(scope.sessionId, event, epoch)),
    [perform],
  )
  const createTab = useCallback(
    () => perform((scope, epoch) => browserService.createTab(scope.sessionId, epoch), true, true),
    [perform],
  )
  const activateTab = useCallback(
    (tabId: string) => perform((scope, epoch) => browserService.activateTab(scope.sessionId, tabId, epoch), true, true),
    [perform],
  )
  const closeTab = useCallback(
    (tabId: string) => {
      const closesActiveTab = stateRef.current?.active_tab_id === tabId
      return perform(
        (scope, epoch) => browserService.closeTab(scope.sessionId, tabId, epoch),
        closesActiveTab,
        closesActiveTab,
      )
    },
    [perform],
  )

  const inspectDom = useCallback(async () => {
    const scope = scopeRef.current
    if (!scope) return
    const version = mutationVersionRef.current
    setDomLoading(true)
    try {
      const snapshot = await browserService.dom(scope.sessionId, scope.controller.signal)
      if (scopeRef.current !== scope || scope.controller.signal.aborted) return
      const stateVersion = stateVersionRef.current
      const refreshed = await browserService.get(scope.sessionId, scope.controller.signal)
      if (scopeRef.current !== scope || scope.controller.signal.aborted) return
      if (stateVersion === stateVersionRef.current) publishState(refreshed)
      if (
        version !== mutationVersionRef.current ||
        !matchesActiveBrowserPage(snapshot, stateRef.current) ||
        snapshot.url !== stateRef.current?.url
      ) return
      setDom(snapshot)
      setError(null)
    } catch (cause) {
      if (scopeRef.current === scope && !scope.controller.signal.aborted) {
        setError(userMessage(cause))
      }
    } finally {
      if (scopeRef.current === scope) setDomLoading(false)
    }
  }, [publishState])

  const captureScreenshot = useCallback(async (): Promise<BrowserScreenshot | null> => {
    const scope = scopeRef.current
    if (!scope || !stateRef.current) return null
    const version = mutationVersionRef.current
    setScreenshotLoading(true)
    try {
      const screenshot = await browserService.screenshot(scope.sessionId, scope.controller.signal)
      if (scopeRef.current !== scope || scope.controller.signal.aborted) return null
      const stateVersion = stateVersionRef.current
      const refreshed = await browserService.get(scope.sessionId, scope.controller.signal)
      if (scopeRef.current !== scope || scope.controller.signal.aborted) return null
      if (stateVersion === stateVersionRef.current) publishState(refreshed)
      if (version !== mutationVersionRef.current || !matchesActiveBrowserPage(screenshot, stateRef.current)) return null
      setError(null)
      return screenshot
    } catch (cause) {
      if (scopeRef.current === scope && !scope.controller.signal.aborted) {
        setError(userMessage(cause))
      }
      return null
    } finally {
      if (scopeRef.current === scope) setScreenshotLoading(false)
    }
  }, [publishState])

  const isCurrentPage = useCallback(
    (candidate: { page_epoch: number; active_tab_id?: string }) =>
      matchesActiveBrowserPage(candidate, stateRef.current),
    [],
  )

  const retry = useCallback(() => setRetryVersion((version) => version + 1), [])

  return {
    state,
    frame,
    dom,
    loading,
    busy,
    domLoading,
    screenshotLoading,
    error,
    navigate,
    history,
    viewport,
    input,
    createTab,
    activateTab,
    closeTab,
    inspectDom,
    captureScreenshot,
    isCurrentPage,
    clearDom: () => setDom(null),
    retry,
  }
}
