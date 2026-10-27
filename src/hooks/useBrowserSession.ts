import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { isApiError, NetworkRequestError, RequestCancelledError, RequestTimeoutError } from "@services/api"
import { browserService } from "@services/browser/BrowserService"
import { readBrowserProfileReport, type BrowserProfileReport } from "@services/browser/profileMode"
import { matchesActiveBrowserPage } from "@/lib/browserFrame"
import type {
  BrowserDomSnapshot,
  BrowserFrame,
  BrowserHistoryDirection,
  BrowserInput,
  BrowserProfileMode,
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

type Invalidation = boolean | ((state: BrowserState) => boolean)

const TRANSIENT_STATE_READ_NOTICE_THRESHOLD = 3

const browserErrorCode = (error: unknown): string | null => {
  if (!isApiError(error) || !error.body) return null
  try {
    const body = JSON.parse(error.body) as { error?: { code?: unknown } }
    return typeof body.error?.code === "string" ? body.error.code : null
  } catch {
    return null
  }
}

const isBrowserBusy = (error: unknown): boolean =>
  isApiError(error) && error.status === 503 && browserErrorCode(error) === "browser_busy"

const isTransientStateReadError = (error: unknown): boolean =>
  (isApiError(error) && error.status >= 500 && error.status < 600 && !isBrowserBusy(error)) ||
  error instanceof NetworkRequestError || error instanceof RequestTimeoutError

const conflictCode = (error: unknown): string | null =>
  isApiError(error) && error.status === 409 ? browserErrorCode(error) : null
const isBrowserClosed = (error: unknown): boolean =>
  isApiError(error) && error.status === 404 && browserErrorCode(error) === "browser_not_open"
class BrowserProfileOutcomeUnknown extends Error {}

const userMessage = (error: unknown): string => {
  if (error instanceof BrowserProfileOutcomeUnknown) return uiText("browser_profile_outcome_unknown")
  if (isApiError(error)) {
    if (isBrowserBusy(error)) return uiText("browser_request_busy")
    if (conflictCode(error) === "browser_profile_mode_conflict") return uiText("browser_profile_conflict")
    if (error.status === 404) return uiText("this_bamboo_version_does_not_provide_a_built_in_browser_625d56e1")
    if (error.status === 409) {
      if (conflictCode(error) === "dialog_pending") return uiText("handle_the_web_dialog_first_55d896f4")
      if (conflictCode(error) === "stale_dialog") return uiText("the_web_dialog_changed_state_was_refreshed_b70b58be")
      return uiText("page_state_changed_and_was_refreshed_retry_the_operatio_27f1b7ca")
    }
    if (error.status === 503) return uiText("browser_runtime_is_temporarily_unavailable_try_again_la_4ef4c6b7")
  }
  return uiText("the_browser_is_unavailable_right_now_try_again_93656b3a")
}

export function useBrowserSession(sessionId: string | null, active: boolean) {
  useUiLocale()
  const [state, setState] = useState<BrowserState | null>(null)
  const [readySessionId, setReadySessionId] = useState<string | null>(null)
  const [frame, setFrame] = useState<DisplayedBrowserFrame | null>(null)
  const [dom, setDom] = useState<BrowserDomSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [domLoading, setDomLoading] = useState(false)
  const [screenshotLoading, setScreenshotLoading] = useState(false)
  const [errorCause, setErrorCause] = useState<{ cause: unknown; profileOutcomeUnknown?: boolean } | null>(null)
  const error = errorCause === null ? null
    : errorCause.profileOutcomeUnknown && !(errorCause.cause instanceof BrowserProfileOutcomeUnknown)
      ? `${uiText("browser_profile_outcome_unknown")} ${userMessage(errorCause.cause)}`
      : userMessage(errorCause.cause)
  const [retryVersion, setRetryVersion] = useState(0)
  const [profile, setProfile] = useState<BrowserProfileReport>({ kind: "unreported" })
  const [profilePhase, setProfilePhase] = useState<"active" | "closed" | "unknown">("unknown")
  const profilePhaseRef = useRef(profilePhase)
  const profileReportsRef = useRef(new Map<string, BrowserProfileReport>())
  const profileFlightsRef = useRef(new Map<string, Promise<void>>())
  const profileFailuresRef = useRef(new Map<string, unknown>())
  const scopeRef = useRef<Scope | null>(null)
  const stateRef = useRef<BrowserState | null>(null)
  const stateVersionRef = useRef(0)
  const mutationVersionRef = useRef(0)
  const framePollResetRef = useRef(0)
  const frameSuspendedRef = useRef(false)
  const actionQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  const publishState = useCallback((next: BrowserState) => {
    const previous = stateRef.current
    const pageChanged = Boolean(previous && (
      previous.page_epoch !== next.page_epoch ||
      previous.active_tab_id !== next.active_tab_id ||
      previous.url !== next.url
    ))
    const dialogChanged = previous?.pending_dialog?.dialog_id !== next.pending_dialog?.dialog_id ||
      previous?.pending_dialog?.status !== next.pending_dialog?.status
    if (pageChanged || dialogChanged) {
      mutationVersionRef.current += 1
      setDom(null)
    }
    if (dialogChanged) framePollResetRef.current += 1
    if (pageChanged && (!next.pending_dialog || previous?.active_tab_id !== next.active_tab_id || previous?.url !== next.url)) {
      setFrame(null)
    }
    stateRef.current = next
    stateVersionRef.current += 1
    setState(next)
    const report = readBrowserProfileReport(next)
    const id = scopeRef.current?.sessionId
    if (id && report.kind === "reported") profileReportsRef.current.set(id, report)
    else if (id) profileReportsRef.current.delete(id)
    setProfile(report)
    profilePhaseRef.current = "active"
    setProfilePhase("active")
  }, [])

  const publishClosed = useCallback((id: string) => {
    stateRef.current = null
    stateVersionRef.current += 1
    mutationVersionRef.current += 1
    setState(null)
    setReadySessionId(null)
    setFrame(null)
    setDom(null)
    setLoading(false)
    setProfile(profileReportsRef.current.get(id) ?? { kind: "unreported" })
    profilePhaseRef.current = "closed"
    setProfilePhase("closed")
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
    setReadySessionId(null)
    setFrame(null)
    setDom(null)
    setErrorCause(sessionId && profileFailuresRef.current.has(sessionId) ? { cause: profileFailuresRef.current.get(sessionId) } : null)
    setBusy(Boolean(sessionId && profileFlightsRef.current.has(sessionId)))
    setProfile(sessionId ? profileReportsRef.current.get(sessionId) ?? { kind: "unreported" } : { kind: "unreported" })
    profilePhaseRef.current = "unknown"
    setProfilePhase("unknown")
    setDomLoading(false)
    setScreenshotLoading(false)
    setLoading(Boolean(sessionId && active))
    if (!sessionId || !active) return

    const controller = new AbortController()
    const scope: Scope = { sessionId, controller }
    scopeRef.current = scope
    const isCurrent = () => scopeRef.current === scope && !controller.signal.aborted

    const run = async () => {
      // browser_not_open already exists on older hosts. A read never proves
      // support for mode-bearing writes and must never bootstrap a browser.
      const initial = await browserService.get(sessionId, controller.signal)
      if (!isCurrent()) return
      publishState(initial)
      setReadySessionId(sessionId)
      setLoading(false)

      let after = 0
      let observedEpoch = initial.page_epoch
      let observedTabId = initial.active_tab_id
      let observedReset = framePollResetRef.current
      let lastStateRefresh = Date.now()
      let pendingStateReadFailures = 0
      let emptyStateReadFailures = 0
      while (isCurrent()) {
        if (stateRef.current?.tabs?.length === 0) {
          // There is no page to render. An empty /frame response may return
          // immediately, so watch for agent-created tabs through bounded
          // state reads instead of spinning on frame requests.
          await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 500 * (emptyStateReadFailures + 1))))
          if (!isCurrent()) return
          if (stateRef.current?.tabs?.length !== 0) continue
          const version = stateVersionRef.current
          let refreshed: BrowserState
          try {
            refreshed = await browserService.get(sessionId, controller.signal)
          } catch (cause) {
            if (!isCurrent()) return
            if (isTransientStateReadError(cause)) {
              emptyStateReadFailures += 1
              if (emptyStateReadFailures >= TRANSIENT_STATE_READ_NOTICE_THRESHOLD) setErrorCause({ cause })
              continue
            }
            throw cause
          }
          if (!isCurrent()) return
          if (emptyStateReadFailures > 0) setErrorCause(null)
          emptyStateReadFailures = 0
          if (version === stateVersionRef.current) publishState(refreshed)
          lastStateRefresh = Date.now()
          continue
        }
        if (stateRef.current?.pending_dialog) {
          // Bamboo only permits state reads while a page dialog blocks CDP.
          // Keep the last JPEG visible and observe model responses or expiry.
          await new Promise((resolve) => setTimeout(resolve, 400))
          if (!isCurrent()) return
          const version = stateVersionRef.current
          let refreshed: BrowserState
          try {
            refreshed = await browserService.get(sessionId, controller.signal)
          } catch (cause) {
            if (!isCurrent()) return
            if (isTransientStateReadError(cause) && ++pendingStateReadFailures < TRANSIENT_STATE_READ_NOTICE_THRESHOLD) continue
            throw cause
          }
          if (!isCurrent()) return
          pendingStateReadFailures = 0
          if (version === stateVersionRef.current) publishState(refreshed)
          lastStateRefresh = Date.now()
          continue
        }
        pendingStateReadFailures = 0
        if (frameSuspendedRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          continue
        }
        const pageChangedBeforePoll = Boolean(stateRef.current && (
          stateRef.current.page_epoch !== observedEpoch ||
          stateRef.current.active_tab_id !== observedTabId
        ))
        if (stateRef.current && (pageChangedBeforePoll || framePollResetRef.current !== observedReset)) {
          observedEpoch = stateRef.current.page_epoch
          observedTabId = stateRef.current.active_tab_id
          observedReset = framePollResetRef.current
          after = 0
          if (pageChangedBeforePoll) setFrame(null)
        }
        const requestReset = framePollResetRef.current
        const requestEpoch = observedEpoch
        const requestTabId = observedTabId
        let next: BrowserFrame | null
        try {
          next = await browserService.frame(sessionId, after, 1500, controller.signal)
        } catch (cause) {
          if (!isCurrent()) return
          if (isApiError(cause) && cause.status === 409) {
            const version = stateVersionRef.current
            const refreshed = await browserService.get(sessionId, controller.signal)
            if (!isCurrent()) return
            if (version === stateVersionRef.current) publishState(refreshed)
            continue
          }
          throw cause
        }
        if (!isCurrent()) return
        if (requestReset !== framePollResetRef.current || frameSuspendedRef.current) {
          after = 0
          if (!stateRef.current?.pending_dialog) setFrame(null)
          continue
        }
        const pageChangedDuringPoll = Boolean(stateRef.current && (
          stateRef.current.page_epoch !== observedEpoch ||
          stateRef.current.active_tab_id !== observedTabId
        ))
        if (stateRef.current && (
          pageChangedDuringPoll ||
          framePollResetRef.current !== observedReset
        )) {
          observedEpoch = stateRef.current.page_epoch
          observedTabId = stateRef.current.active_tab_id
          observedReset = framePollResetRef.current
          after = 0
          if (!stateRef.current?.pending_dialog) setFrame(null)
        }
        if (next && !matchesActiveBrowserPage(next, stateRef.current)) {
          const version = stateVersionRef.current
          const refreshed = await browserService.get(sessionId, controller.signal)
          if (!isCurrent()) return
          let pageChanged = false
          if (version === stateVersionRef.current) {
            const previous = stateRef.current
            publishState(refreshed)
            pageChanged = previous?.page_epoch !== refreshed.page_epoch ||
              previous?.active_tab_id !== refreshed.active_tab_id
          }
          const pageChangedSinceRequest = stateRef.current?.page_epoch !== requestEpoch ||
            stateRef.current?.active_tab_id !== requestTabId
          observedEpoch = stateRef.current?.page_epoch ?? observedEpoch
          observedTabId = stateRef.current?.active_tab_id
          observedReset = framePollResetRef.current
          setFrame(null)
          // A recovered host may start with a lower epoch and reset its frame
          // sequence. Resume from zero when the active page identity changes.
          if (pageChangedSinceRequest || pageChanged) after = 0
          if (!matchesActiveBrowserPage(next, stateRef.current)) {
            // Frame sequence is session-monotonic. Wait past this stale JPEG
            // on the same host instead of fetching it in a hot loop.
            if (!pageChangedSinceRequest && !pageChanged) after = Math.max(after, next.frame_seq)
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
      if (isBrowserClosed(cause)) { publishClosed(sessionId); return }
      setErrorCause({ cause, profileOutcomeUnknown: profileFailuresRef.current.get(sessionId) instanceof BrowserProfileOutcomeUnknown })
      setLoading(false)
    })

    return () => {
      controller.abort()
      if (scopeRef.current === scope) scopeRef.current = null
    }
  }, [sessionId, active, retryVersion, publishState, publishClosed])

  const refreshOnConflict = useCallback(async (scope: Scope, cause: unknown): Promise<boolean> => {
    if (!isApiError(cause) || cause.status !== 409) return false
    const version = stateVersionRef.current
    try {
      const refreshed = await browserService.get(scope.sessionId, scope.controller.signal)
      if (scopeRef.current === scope && !scope.controller.signal.aborted && version === stateVersionRef.current) {
        publishState(refreshed)
      }
    } catch (readError) {
      if (scopeRef.current === scope && !scope.controller.signal.aborted && isBrowserClosed(readError)) publishClosed(scope.sessionId)
      // Keep the original conflict as the actionable failure.
    }
    return true
  }, [publishState, publishClosed])

  const perform = useCallback(
    (
      action: (scope: Scope, expectedEpoch: number) => Promise<BrowserState>,
      invalidateDom: Invalidation = true,
      invalidateFrame: Invalidation = false,
      markBusy = true,
    ): Promise<BrowserState | null> => {
      const scope = scopeRef.current
      if (!scope || !stateRef.current) return Promise.resolve(null)

      const task = actionQueueRef.current.catch(() => undefined).then(async () => {
        if (scopeRef.current !== scope || scope.controller.signal.aborted) return null
        const currentState = stateRef.current
        if (!currentState || currentState.pending_dialog) return null
        const expectedEpoch = currentState.page_epoch
        const shouldInvalidateDom = typeof invalidateDom === "function" ? invalidateDom(currentState) : invalidateDom
        const shouldInvalidateFrame = typeof invalidateFrame === "function" ? invalidateFrame(currentState) : invalidateFrame
        if (shouldInvalidateDom) {
          mutationVersionRef.current += 1
          setDom(null)
        }
        if (shouldInvalidateFrame) {
          frameSuspendedRef.current = true
          framePollResetRef.current += 1
          setFrame(null)
        }
        if (markBusy) setBusy(true)
        try {
          const next = await action(scope, expectedEpoch)
          if (scopeRef.current !== scope || scope.controller.signal.aborted) return null
          publishState(next)
          setErrorCause(null)
          return next
        } catch (cause) {
          if (scopeRef.current !== scope || scope.controller.signal.aborted) return null
          await refreshOnConflict(scope, cause)
          if (scopeRef.current !== scope || scope.controller.signal.aborted) return null
          if (conflictCode(cause) === "dialog_pending" || stateRef.current?.pending_dialog) {
            setErrorCause(null)
            return null
          }
          setErrorCause({ cause })
          return null
        } finally {
          if (shouldInvalidateFrame && scopeRef.current === scope) {
            frameSuspendedRef.current = false
            framePollResetRef.current += 1
          }
          if (markBusy && scopeRef.current === scope) setBusy(false)
        }
      })
      actionQueueRef.current = task
      return task
    },
    [publishState, refreshOnConflict],
  )

  const navigate = useCallback(
    (url: string) => perform((scope, epoch) => browserService.navigate(scope.sessionId, url, epoch)),
    [perform],
  )
  const openUrlInNewTab = useCallback(
    (url: string) => perform(async (scope, epoch) => {
      if (stateRef.current?.tabs) {
        return browserService.createTab(scope.sessionId, epoch, url)
      }
      return browserService.navigate(scope.sessionId, url, epoch)
    }, true, true),
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
      const closesActiveTab = (state: BrowserState) => state.active_tab_id === tabId
      return perform(
        (scope, epoch) => browserService.closeTab(scope.sessionId, tabId, epoch),
        closesActiveTab,
        closesActiveTab,
      )
    },
    [perform],
  )

  const respondDialog = useCallback((accept: boolean, text?: string): Promise<void> => {
    const scope = scopeRef.current
    const current = stateRef.current
    const dialog = current?.pending_dialog
    if (!scope || !current || !dialog || dialog.status !== "pending") return Promise.resolve()
    const matchesDialog = () => {
      const latest = stateRef.current
      return scopeRef.current === scope && !scope.controller.signal.aborted &&
        latest?.page_epoch === current.page_epoch && latest.active_tab_id === current.active_tab_id &&
        latest.pending_dialog?.dialog_id === dialog.dialog_id &&
        latest.pending_dialog.page_epoch === dialog.page_epoch &&
        latest.pending_dialog.tab_id === dialog.tab_id &&
        latest.pending_dialog.status === "pending"
    }
    const task = actionQueueRef.current.catch(() => undefined).then(async () => {
      if (!matchesDialog()) return
      setBusy(true)
      try {
        const next = await browserService.respondDialog(scope.sessionId, {
          dialog_id: dialog.dialog_id,
          expected_epoch: dialog.page_epoch,
          accept,
          ...(text !== undefined ? { text } : {}),
        })
        if (!matchesDialog()) return
        publishState(next)
        setErrorCause(null)
      } catch (cause) {
        if (!matchesDialog()) return
        await refreshOnConflict(scope, cause)
        if (!matchesDialog()) {
          setErrorCause(null)
          return
        }
        setErrorCause({ cause })
      } finally {
        if (scopeRef.current === scope) setBusy(false)
      }
    })
    actionQueueRef.current = task
    return task
  }, [publishState, refreshOnConflict])

  const inspectDom = useCallback(async () => {
    const scope = scopeRef.current
    if (!scope || stateRef.current?.pending_dialog) return
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
      setErrorCause(null)
    } catch (cause) {
      if (scopeRef.current === scope && !scope.controller.signal.aborted) {
        await refreshOnConflict(scope, cause)
        if (scopeRef.current === scope) setErrorCause(stateRef.current?.pending_dialog ? null : { cause })
      }
    } finally {
      if (scopeRef.current === scope) setDomLoading(false)
    }
  }, [publishState, refreshOnConflict])

  const captureScreenshot = useCallback(async (): Promise<BrowserScreenshot | null> => {
    const scope = scopeRef.current
    if (!scope || !stateRef.current || stateRef.current.pending_dialog) return null
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
      setErrorCause(null)
      return screenshot
    } catch (cause) {
      if (scopeRef.current === scope && !scope.controller.signal.aborted) {
        await refreshOnConflict(scope, cause)
        if (scopeRef.current === scope) setErrorCause(stateRef.current?.pending_dialog ? null : { cause })
      }
      return null
    } finally {
      if (scopeRef.current === scope) setScreenshotLoading(false)
    }
  }, [publishState, refreshOnConflict])

  const isCurrentPage = useCallback(
    (candidate: { page_epoch: number; active_tab_id?: string }) =>
      matchesActiveBrowserPage(candidate, stateRef.current),
    [],
  )

  const changeProfile = useCallback((id: string, operation: "open" | "close", mode?: BrowserProfileMode, explicitClean = false): Promise<void> => {
    const previousScope = scopeRef.current
    if (!previousScope || previousScope.sessionId !== id || previousScope.controller.signal.aborted ||
      profileFlightsRef.current.has(id) || stateRef.current?.pending_dialog || busy) return Promise.resolve()
    if (operation === "close") {
      if (profilePhaseRef.current !== "active" || readBrowserProfileReport(stateRef.current).kind !== "reported") return Promise.resolve()
    } else {
      if (profilePhaseRef.current !== "closed") return Promise.resolve()
      // A legacy404 is not a profile capability. The ordinary selector still
      // requires a report. A separate user action may request clean explicitly;
      // its ACK and canonical read must confirm the mode before it is shown.
      if (mode !== undefined && ((mode !== "shared" && mode !== "clean") ||
        (!profileReportsRef.current.has(id) && !(explicitClean && mode === "clean")))) return Promise.resolve()
    }

    profileFailuresRef.current.delete(id)
    const scope: Scope = { sessionId: id, controller: new AbortController() }
    scopeRef.current = scope
    previousScope.controller.abort()
    stateVersionRef.current += 1
    mutationVersionRef.current += 1
    setFrame(null)
    setDom(null)
    setBusy(true)
    setErrorCause(null)
    // Install the flight before yielding; a second intent must not queue another write.
    const task = Promise.resolve().then(async () => {
      try {
        if (operation === "close") await browserService.close(id, scope.controller.signal)
        else {
          const next = mode === undefined
            ? await browserService.open(id, scope.controller.signal)
            : await browserService.openProfile(id, mode, scope.controller.signal)
          const report = readBrowserProfileReport(next)
          if (report.kind === "invalid" || (mode !== undefined && (report.kind !== "reported" || report.mode !== mode))) {
            throw new Error("Unconfirmed browser profile response")
          }
        }
      } catch (cause) {
        const failure = !isApiError(cause) || (cause.status >= 500 && !isBrowserBusy(cause))
          ? new BrowserProfileOutcomeUnknown("Browser operation outcome unconfirmed", { cause }) : cause
        profileFailuresRef.current.set(id, failure)
      } finally {
        profileFlightsRef.current.delete(id)
        // Ignore the write's raw ACK. A fresh GET is the only source of the
        // current chat view, including when A was left and selected again.
        if (scopeRef.current?.sessionId === id) setRetryVersion((version) => version + 1)
      }
    })
    profileFlightsRef.current.set(id, task)
    return task
  }, [busy])
  const openProfile = useCallback((id: string, mode: BrowserProfileMode) => changeProfile(id, "open", mode), [changeProfile])
  const openDefault = useCallback((id: string) => changeProfile(id, "open"), [changeProfile])
  const openClean = useCallback((id: string) => changeProfile(id, "open", "clean", true), [changeProfile])
  const closeProfile = useCallback((id: string) => changeProfile(id, "close"), [changeProfile])

  const retry = useCallback(() => setRetryVersion((version) => version + 1), [])
  const hasPendingDialog = useCallback(() => Boolean(stateRef.current?.pending_dialog), [])

  return {
    state,
    readySessionId,
    profile,
    profilePhase,
    openProfile,
    openDefault,
    openClean,
    closeProfile,
    frame,
    dom,
    loading,
    busy,
    domLoading,
    screenshotLoading,
    error,
    navigate,
    openUrlInNewTab,
    history,
    viewport,
    input,
    createTab,
    activateTab,
    closeTab,
    respondDialog,
    inspectDom,
    captureScreenshot,
    isCurrentPage,
    clearDom: () => setDom(null),
    retry,
    hasPendingDialog,
  }
}
