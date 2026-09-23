import { useCallback, useEffect, useRef, useState } from "react"
import { isApiError, RequestCancelledError } from "@services/api"
import { browserService } from "@services/browser/BrowserService"
import type {
  BrowserDomSnapshot,
  BrowserFrame,
  BrowserHistoryDirection,
  BrowserInput,
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
  const actionQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  const publishState = useCallback((next: BrowserState) => {
    const previous = stateRef.current
    if (previous && (previous.page_epoch !== next.page_epoch || previous.url !== next.url)) {
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
      let lastStateRefresh = Date.now()
      while (isCurrent()) {
        if (stateRef.current && stateRef.current.page_epoch !== observedEpoch) {
          observedEpoch = stateRef.current.page_epoch
          after = 0
          setFrame(null)
        }
        const next = await browserService.frame(sessionId, after, 1500, controller.signal)
        if (!isCurrent()) return
        if (stateRef.current && stateRef.current.page_epoch !== observedEpoch) {
          observedEpoch = stateRef.current.page_epoch
          after = 0
          setFrame(null)
        }
        if (next && next.page_epoch !== stateRef.current?.page_epoch) {
          const version = stateVersionRef.current
          const refreshed = await browserService.get(sessionId, controller.signal)
          if (!isCurrent()) return
          if (version === stateVersionRef.current) {
            publishState(refreshed)
          }
          observedEpoch = stateRef.current?.page_epoch ?? observedEpoch
          after = 0
          setFrame(null)
          if (next.page_epoch !== observedEpoch) continue
        }
        if (next && next.frame_seq > after) {
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
        setBusy(true)
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
          if (scopeRef.current === scope) setBusy(false)
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
      perform((scope, epoch) => browserService.viewport(scope.sessionId, size, epoch), false),
    [perform],
  )
  const input = useCallback(
    (event: BrowserInput) =>
      perform((scope, epoch) => browserService.input(scope.sessionId, event, epoch)),
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
      if (
        version !== mutationVersionRef.current ||
        snapshot.page_epoch !== stateRef.current?.page_epoch ||
        snapshot.url !== stateRef.current.url
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
  }, [])

  const captureScreenshot = useCallback(async (): Promise<Blob | null> => {
    const scope = scopeRef.current
    if (!scope) return null
    setScreenshotLoading(true)
    try {
      const screenshot = await browserService.screenshot(scope.sessionId, scope.controller.signal)
      if (scopeRef.current !== scope || scope.controller.signal.aborted) return null
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
  }, [])

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
    inspectDom,
    captureScreenshot,
    clearDom: () => setDom(null),
    retry,
  }
}
