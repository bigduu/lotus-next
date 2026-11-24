import { createEffect, createMemo, createSignal, onSettled, untrack, type Accessor } from "solid-js"
import { createUiText } from "../../shell/uiText"
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

type EntryOpenRequest = { sessionId: string; phase: "waiting" | "read" | "opening" }

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

const isSharedProfileUnsupported = (error: unknown): boolean => {
  if (!isApiError(error) || error.status !== 503 || !error.body) return false
  try {
    const body = JSON.parse(error.body) as { error?: { code?: unknown; type?: unknown; message?: unknown } }
    return body.error?.code === "browser_unavailable" && body.error.type === "browser_error" &&
      body.error.message === "browser runtime unavailable: browser_shared_profile_unsupported: request clean explicitly"
  } catch {
    return false
  }
}

const isTransientStateReadError = (error: unknown): boolean =>
  (isApiError(error) && error.status >= 500 && error.status < 600 && !isBrowserBusy(error)) ||
  error instanceof NetworkRequestError || error instanceof RequestTimeoutError

const conflictCode = (error: unknown): string | null =>
  isApiError(error) && error.status === 409 ? browserErrorCode(error) : null
const isBrowserClosed = (error: unknown): boolean =>
  isApiError(error) && error.status === 404 && browserErrorCode(error) === "browser_not_open"
class BrowserProfileOutcomeUnknown extends Error {}

const userMessage = (error: unknown, text: ReturnType<typeof createUiText>): string => {
  if (error instanceof BrowserProfileOutcomeUnknown) return text("browser_profile_outcome_unknown")
  if (isApiError(error)) {
    if (isBrowserBusy(error)) return text("browser_request_busy")
    if (isSharedProfileUnsupported(error)) return text("browser_shared_unsupported")
    if (conflictCode(error) === "browser_profile_mode_conflict") return text("browser_profile_conflict")
    if (error.status === 404) return text("this_bamboo_version_does_not_provide_a_built_in_browser_625d56e1")
    if (error.status === 409) {
      if (conflictCode(error) === "dialog_pending") return text("handle_the_web_dialog_first_55d896f4")
      if (conflictCode(error) === "stale_dialog") return text("the_web_dialog_changed_state_was_refreshed_b70b58be")
      return text("page_state_changed_and_was_refreshed_retry_the_operatio_27f1b7ca")
    }
    if (error.status === 503) return text("browser_runtime_is_temporarily_unavailable_try_again_la_4ef4c6b7")
  }
  return text("the_browser_is_unavailable_right_now_try_again_93656b3a")
}

export function createBrowserSession(readSessionId: Accessor<string | null>, readActive: Accessor<boolean>) {
  const text = createUiText()
  // Workbench order and selection can change while this same browser stays live.
  const sessionId = createMemo(readSessionId)
  const active = createMemo(readActive)
  const [state, setState] = createSignal<BrowserState | null>(null)
  const [readySessionId, setReadySessionId] = createSignal<string | null>(null)
  const [frame, setFrame] = createSignal<DisplayedBrowserFrame | null>(null)
  const [dom, setDom] = createSignal<BrowserDomSnapshot | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [domLoading, setDomLoading] = createSignal(false)
  const [screenshotLoading, setScreenshotLoading] = createSignal(false)
  const [errorCause, setErrorCause] = createSignal<{ cause: unknown; profileOutcomeUnknown?: boolean; source?: "empty-state-read" } | null>(null)
  const entryActionFailures = new Map<string, unknown>()
  const [retryVersion, setRetryVersion] = createSignal(0)
  const [profile, setProfile] = createSignal<BrowserProfileReport>({ kind: "unreported" })
  const [profilePhase, setProfilePhase] = createSignal<"active" | "closed" | "unknown">("unknown")
  let currentPhase: "active" | "closed" | "unknown" = "unknown"
  const profileReports = new Map<string, BrowserProfileReport>()
  const profileFlights = new Map<string, Promise<void>>()
  const profileFailures = new Map<string, unknown>()
  let currentScope: Scope | null = null
  let readScope: Scope | null = null
  let initialReadPending: Scope | null = null
  const actionsByScope = new Map<Scope, number>()
  let entryOpen: EntryOpenRequest | null = null
  const [entryOpenVersion, setEntryOpenVersion] = createSignal(0)
  const [entryOpening, setEntryOpening] = createSignal(false)
  let browserState: BrowserState | null = null
  let stateVersion = 0
  let mutationVersion = 0
  let framePollGeneration = 0
  let frameSuspended = false
  let actionQueue: Promise<unknown> = Promise.resolve()

  const error = createMemo(() => {
    // Retry invalidates any stored error for the active entry attempt.
    retryVersion()
    const current = errorCause()
    const currentError = current === null ? null
      : current.profileOutcomeUnknown && !(current.cause instanceof BrowserProfileOutcomeUnknown)
        ? `${text("browser_profile_outcome_unknown")} ${userMessage(current.cause, text)}`
        : userMessage(current.cause, text)
    const id = sessionId()
    const entryError = id && entryActionFailures.has(id) ? userMessage(entryActionFailures.get(id), text) : null
    return entryError && currentError && entryError !== currentError
      ? `${entryError} ${currentError}` : entryError || currentError
  })

  onSettled(() => () => {
    currentScope?.controller.abort()
    currentScope = null
  })

  const publishState = (next: BrowserState) => {
    const previous = browserState
    const pageChanged = Boolean(previous && (
      previous.page_epoch !== next.page_epoch ||
      previous.active_tab_id !== next.active_tab_id ||
      previous.url !== next.url
    ))
    const dialogChanged = previous?.pending_dialog?.dialog_id !== next.pending_dialog?.dialog_id ||
      previous?.pending_dialog?.status !== next.pending_dialog?.status
    if (pageChanged || dialogChanged) {
      mutationVersion += 1
      setDom(null)
    }
    if (dialogChanged) framePollGeneration += 1
    if (pageChanged && (!next.pending_dialog || previous?.active_tab_id !== next.active_tab_id || previous?.url !== next.url)) {
      setFrame(null)
    }
    browserState = next
    stateVersion += 1
    setState(next)
    const report = readBrowserProfileReport(next)
    const id = currentScope?.sessionId
    if (id && report.kind === "reported") profileReports.set(id, report)
    else if (id) profileReports.delete(id)
    setProfile(report)
    currentPhase = "active"
    setProfilePhase("active")
  }

  const publishClosed = (id: string) => {
    browserState = null
    stateVersion += 1
    mutationVersion += 1
    setState(null)
    setReadySessionId(null)
    setFrame(null)
    setDom(null)
    setLoading(false)
    setProfile(profileReports.get(id) ?? { kind: "unreported" })
    currentPhase = "closed"
    setProfilePhase("closed")
  }

  const finishEntryOpen = (id: string) => {
    if (entryOpen?.sessionId !== id) return
    entryOpen = null
    setEntryOpening(false)
  }

  // A click on the Browser entry is the authorization to open a closed scope.
  // Keep one intent until its canonical read and any resulting write settle.
  const requestEntryOpen = (id: string) => {
    if (id !== sessionId() || entryOpen?.sessionId === id) return
    const joinsInitialRead = initialReadPending === currentScope && currentScope?.sessionId === id && !profileFlights.has(id)
    entryOpen = { sessionId: id, phase: joinsInitialRead ? "read" : "waiting" }
    setEntryOpening(true)
    setEntryOpenVersion((version) => version + 1)
  }

  createEffect(frame, (frame) => frame ? () => URL.revokeObjectURL(frame.objectUrl) : undefined)

  createEffect(
    () => ({ sessionId: sessionId(), active: active(), retry: retryVersion() }),
    ({ sessionId, active }) => {
      currentScope?.controller.abort()
      currentScope = null
      readScope = null
      if (!sessionId || !active || (entryOpen && entryOpen.sessionId !== sessionId)) {
        entryOpen = null
        setEntryOpening(false)
      } else if (entryOpen?.phase === "read" || entryOpen?.phase === "waiting") {
        setEntryOpening(true)
      }
      browserState = null
      mutationVersion += 1
      framePollGeneration += 1
      frameSuspended = false
      actionQueue = Promise.resolve()
      setState(null)
      setReadySessionId(null)
      setFrame(null)
      setDom(null)
      setErrorCause(sessionId && profileFailures.has(sessionId) ? { cause: profileFailures.get(sessionId) } : null)
      setBusy(Boolean(sessionId && profileFlights.has(sessionId)))
      setProfile(sessionId ? profileReports.get(sessionId) ?? { kind: "unreported" } : { kind: "unreported" })
      currentPhase = "unknown"
      setProfilePhase("unknown")
      setDomLoading(false)
      setScreenshotLoading(false)
      setLoading(Boolean(sessionId && active))
      if (!sessionId || !active) return

      const controller = new AbortController()
      const scope: Scope = { sessionId, controller }
      currentScope = scope
      initialReadPending = scope
      // The entry click can activate the scope before its intent effect runs.
      // Attach that intent before a fast canonical read clears the pending ref.
      if (entryOpen?.phase === "waiting" && !profileFlights.has(sessionId)) entryOpen.phase = "read"
      const actionFlights = actionsByScope
      const isCurrent = () => currentScope === scope && !controller.signal.aborted

      const run = async () => {
        // A read never proves support for mode-bearing writes. Only a separate
        // Browser-entry intent may open a closed scope after this read.
        const initial = await browserService.get(sessionId, controller.signal)
        if (!isCurrent()) return
        if (initialReadPending === scope) initialReadPending = null
        readScope = scope
        publishState(initial)
        setReadySessionId(sessionId)
        setLoading(false)
        finishEntryOpen(sessionId)

        let after = 0
        let observedEpoch = initial.page_epoch
        let observedTabId = initial.active_tab_id
        let observedReset = framePollGeneration
        let lastStateRefresh = Date.now()
        let pendingStateReadFailures = 0
        let emptyStateReadFailures = 0
        while (isCurrent()) {
          if (browserState?.tabs?.length === 0) {
            // There is no page to render. An empty /frame response may return
            // immediately, so watch for agent-created tabs through bounded
            // state reads instead of spinning on frame requests.
            await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 500 * (emptyStateReadFailures + 1))))
            if (!isCurrent()) return
            if (browserState?.tabs?.length !== 0) continue
            const version = stateVersion
            let refreshed: BrowserState
            try {
              refreshed = await browserService.get(sessionId, controller.signal)
            } catch (cause) {
              if (!isCurrent()) return
              if (isTransientStateReadError(cause)) {
                emptyStateReadFailures += 1
                if (emptyStateReadFailures >= TRANSIENT_STATE_READ_NOTICE_THRESHOLD) {
                  setErrorCause({ cause, profileOutcomeUnknown: profileFailures.get(sessionId) instanceof BrowserProfileOutcomeUnknown, source: "empty-state-read" })
                }
                continue
              }
              throw cause
            }
            if (!isCurrent()) return
            if (emptyStateReadFailures > 0) setErrorCause((current) => {
              if (current?.source !== "empty-state-read") return current
              const failure = profileFailures.get(sessionId)
              return failure === undefined ? null : { cause: failure }
            })
            emptyStateReadFailures = 0
            if (version === stateVersion) publishState(refreshed)
            lastStateRefresh = Date.now()
            continue
          }
          if (browserState?.pending_dialog) {
            // Bamboo only permits state reads while a page dialog blocks CDP.
            // Keep the last JPEG visible and observe model responses or expiry.
            await new Promise((resolve) => setTimeout(resolve, 400))
            if (!isCurrent()) return
            const version = stateVersion
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
            if (version === stateVersion) publishState(refreshed)
            lastStateRefresh = Date.now()
            continue
          }
          pendingStateReadFailures = 0
          if (frameSuspended) {
            await new Promise((resolve) => setTimeout(resolve, 50))
            continue
          }
          const pageChangedBeforePoll = Boolean(browserState && (
            browserState.page_epoch !== observedEpoch ||
            browserState.active_tab_id !== observedTabId
          ))
          if (browserState && (pageChangedBeforePoll || framePollGeneration !== observedReset)) {
            observedEpoch = browserState.page_epoch
            observedTabId = browserState.active_tab_id
            observedReset = framePollGeneration
            after = 0
            if (pageChangedBeforePoll) setFrame(null)
          }
          const requestReset = framePollGeneration
          const requestEpoch = observedEpoch
          const requestTabId = observedTabId
          let next: BrowserFrame | null
          try {
            next = await browserService.frame(sessionId, after, 1500, controller.signal)
          } catch (cause) {
            if (!isCurrent()) return
            if (isApiError(cause) && cause.status === 409) {
              const version = stateVersion
              const refreshed = await browserService.get(sessionId, controller.signal)
              if (!isCurrent()) return
              if (version === stateVersion) publishState(refreshed)
              continue
            }
            throw cause
          }
          if (!isCurrent()) return
          if (requestReset !== framePollGeneration || frameSuspended) {
            after = 0
            if (!browserState?.pending_dialog) setFrame(null)
            continue
          }
          const pageChangedDuringPoll = Boolean(browserState && (
            browserState.page_epoch !== observedEpoch ||
            browserState.active_tab_id !== observedTabId
          ))
          if (browserState && (
            pageChangedDuringPoll ||
            framePollGeneration !== observedReset
          )) {
            observedEpoch = browserState.page_epoch
            observedTabId = browserState.active_tab_id
            observedReset = framePollGeneration
            after = 0
            if (!browserState?.pending_dialog) setFrame(null)
          }
          if (next && !matchesActiveBrowserPage(next, browserState)) {
            const version = stateVersion
            const refreshed = await browserService.get(sessionId, controller.signal)
            if (!isCurrent()) return
            let pageChanged = false
            if (version === stateVersion) {
              const previous = browserState
              publishState(refreshed)
              pageChanged = previous?.page_epoch !== refreshed.page_epoch ||
                previous?.active_tab_id !== refreshed.active_tab_id
            }
            const pageChangedSinceRequest = browserState?.page_epoch !== requestEpoch ||
              browserState?.active_tab_id !== requestTabId
            observedEpoch = browserState?.page_epoch ?? observedEpoch
            observedTabId = browserState?.active_tab_id
            observedReset = framePollGeneration
            setFrame(null)
            // A recovered host may start with a lower epoch and reset its frame
            // sequence. Resume from zero when the active page identity changes.
            if (pageChangedSinceRequest || pageChanged) after = 0
            if (!matchesActiveBrowserPage(next, browserState)) {
              // Frame sequence is session-monotonic. Wait past this stale JPEG
              // on the same host instead of fetching it in a hot loop.
              if (!pageChangedSinceRequest && !pageChanged) after = Math.max(after, next.frame_seq)
              continue
            }
          }
          if (next && matchesActiveBrowserPage(next, browserState) && next.frame_seq > after) {
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
            const version = stateVersion
            const refreshed = await browserService.get(sessionId, controller.signal)
            if (!isCurrent()) return
            if (version === stateVersion) {
              publishState(refreshed)
            }
          }
        }
      }

      void run().catch((cause: unknown) => {
        if (!isCurrent() || cause instanceof RequestCancelledError) return
        if (initialReadPending === scope) initialReadPending = null
        if (isBrowserClosed(cause)) {
          readScope = scope
          publishClosed(sessionId)
          if (entryOpen?.phase === "opening") finishEntryOpen(sessionId)
          return
        }
        setErrorCause({ cause, profileOutcomeUnknown: profileFailures.get(sessionId) instanceof BrowserProfileOutcomeUnknown })
        setLoading(false)
        if (entryOpen?.phase === "opening") finishEntryOpen(sessionId)
        else if (entryOpen?.sessionId === sessionId) setEntryOpening(false)
      })

      return () => {
        controller.abort()
        if (initialReadPending === scope) initialReadPending = null
        actionFlights.delete(scope)
        if (currentScope === scope) currentScope = null
      }
    },
  )

  const refreshOnConflict = async (scope: Scope, cause: unknown): Promise<boolean> => {
    if (!isApiError(cause) || cause.status !== 409) return false
    const version = stateVersion
    try {
      const refreshed = await browserService.get(scope.sessionId, scope.controller.signal)
      if (currentScope === scope && !scope.controller.signal.aborted && version === stateVersion) {
        publishState(refreshed)
      }
    } catch (readError) {
      if (currentScope === scope && !scope.controller.signal.aborted && isBrowserClosed(readError)) publishClosed(scope.sessionId)
      // Keep the original conflict as the actionable failure.
    }
    return true
  }

  const perform = (
    action: (scope: Scope, expectedEpoch: number) => Promise<BrowserState>,
    invalidateDom: Invalidation = true,
    invalidateFrame: Invalidation = false,
    markBusy = true,
  ): Promise<BrowserState | null> => {
    const scope = currentScope
    if (!scope || !browserState) return Promise.resolve(null)

    actionsByScope.set(scope, (actionsByScope.get(scope) ?? 0) + 1)
    const task = actionQueue.catch(() => undefined).then(async () => {
      if (currentScope !== scope || scope.controller.signal.aborted) return null
      const currentState = browserState
      if (!currentState || currentState.pending_dialog) return null
      const expectedEpoch = currentState.page_epoch
      const shouldInvalidateDom = typeof invalidateDom === "function" ? invalidateDom(currentState) : invalidateDom
      const shouldInvalidateFrame = typeof invalidateFrame === "function" ? invalidateFrame(currentState) : invalidateFrame
      if (shouldInvalidateDom) {
        mutationVersion += 1
        setDom(null)
      }
      if (shouldInvalidateFrame) {
        frameSuspended = true
        framePollGeneration += 1
        setFrame(null)
      }
      if (markBusy) setBusy(true)
      try {
        const next = await action(scope, expectedEpoch)
        if (currentScope !== scope || scope.controller.signal.aborted) return null
        publishState(next)
        setErrorCause(null)
        return next
      } catch (cause) {
        if (currentScope !== scope || scope.controller.signal.aborted) return null
        await refreshOnConflict(scope, cause)
        if (currentScope !== scope || scope.controller.signal.aborted) return null
        if (conflictCode(cause) === "dialog_pending" || browserState?.pending_dialog) {
          setErrorCause(null)
          return null
        }
        if (entryOpen?.sessionId === scope.sessionId && entryOpen.phase === "waiting") {
          entryActionFailures.set(scope.sessionId, cause)
        }
        setErrorCause({ cause })
        return null
      } finally {
        if (shouldInvalidateFrame && currentScope === scope) {
          frameSuspended = false
          framePollGeneration += 1
        }
        if (markBusy && currentScope === scope) setBusy(false)
      }
    }).finally(() => {
      const remaining = (actionsByScope.get(scope) ?? 1) - 1
      if (remaining > 0) actionsByScope.set(scope, remaining)
      else actionsByScope.delete(scope)
      if (currentScope === scope && entryOpen?.phase === "waiting") {
        setEntryOpenVersion((version) => version + 1)
      }
    })
    actionQueue = task
    return task
  }

  const navigate = (url: string) => perform((scope, epoch) => browserService.navigate(scope.sessionId, url, epoch))
  const openUrlInNewTab = (url: string) => perform(async (scope, epoch) => {
    if (browserState?.tabs) {
      return browserService.createTab(scope.sessionId, epoch, url)
    }
    return browserService.navigate(scope.sessionId, url, epoch)
  }, true, true)

  const history = (direction: BrowserHistoryDirection) =>
    perform((scope, epoch) => browserService.history(scope.sessionId, direction, epoch))
  const viewport = (size: BrowserViewport) =>
    perform((scope, epoch) => browserService.viewport(scope.sessionId, size, epoch), false, false, false)
  const input = (event: BrowserInput) =>
    perform((scope, epoch) => browserService.input(scope.sessionId, event, epoch))
  const createTab = () => perform((scope, epoch) => browserService.createTab(scope.sessionId, epoch), true, true)
  const activateTab = (tabId: string) => perform((scope, epoch) => browserService.activateTab(scope.sessionId, tabId, epoch), true, true)
  const closeTab = (tabId: string) => {
    const closesActiveTab = (state: BrowserState) => state.active_tab_id === tabId
    return perform(
      (scope, epoch) => browserService.closeTab(scope.sessionId, tabId, epoch),
      closesActiveTab,
      closesActiveTab,
    )
  }

  const respondDialog = (accept: boolean, text?: string): Promise<void> => {
    const scope = currentScope
    const current = browserState
    const dialog = current?.pending_dialog
    if (!scope || !current || !dialog || dialog.status !== "pending") return Promise.resolve()
    const matchesDialog = () => {
      const latest = browserState
      return currentScope === scope && !scope.controller.signal.aborted &&
        latest?.page_epoch === current.page_epoch && latest.active_tab_id === current.active_tab_id &&
        latest.pending_dialog?.dialog_id === dialog.dialog_id &&
        latest.pending_dialog.page_epoch === dialog.page_epoch &&
        latest.pending_dialog.tab_id === dialog.tab_id &&
        latest.pending_dialog.status === "pending"
    }
    const task = actionQueue.catch(() => undefined).then(async () => {
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
        if (currentScope === scope) setBusy(false)
      }
    })
    actionQueue = task
    return task
  }

  const inspectDom = async () => {
    const scope = currentScope
    if (!scope || browserState?.pending_dialog) return
    const version = mutationVersion
    setDomLoading(true)
    try {
      const snapshot = await browserService.dom(scope.sessionId, scope.controller.signal)
      if (currentScope !== scope || scope.controller.signal.aborted) return
      const revisionAtRead = stateVersion
      const refreshed = await browserService.get(scope.sessionId, scope.controller.signal)
      if (currentScope !== scope || scope.controller.signal.aborted) return
      if (revisionAtRead === stateVersion) publishState(refreshed)
      if (
        version !== mutationVersion ||
        !matchesActiveBrowserPage(snapshot, browserState) ||
        snapshot.url !== browserState?.url
      ) return
      setDom(snapshot)
      setErrorCause(null)
    } catch (cause) {
      if (currentScope === scope && !scope.controller.signal.aborted) {
        await refreshOnConflict(scope, cause)
        if (currentScope === scope) setErrorCause(browserState?.pending_dialog ? null : { cause })
      }
    } finally {
      if (currentScope === scope) setDomLoading(false)
    }
  }

  const captureScreenshot = async (): Promise<BrowserScreenshot | null> => {
    const scope = currentScope
    if (!scope || !browserState || browserState.pending_dialog) return null
    const version = mutationVersion
    setScreenshotLoading(true)
    try {
      const screenshot = await browserService.screenshot(scope.sessionId, scope.controller.signal)
      if (currentScope !== scope || scope.controller.signal.aborted) return null
      const revisionAtRead = stateVersion
      const refreshed = await browserService.get(scope.sessionId, scope.controller.signal)
      if (currentScope !== scope || scope.controller.signal.aborted) return null
      if (revisionAtRead === stateVersion) publishState(refreshed)
      if (version !== mutationVersion || !matchesActiveBrowserPage(screenshot, browserState)) return null
      setErrorCause(null)
      return screenshot
    } catch (cause) {
      if (currentScope === scope && !scope.controller.signal.aborted) {
        await refreshOnConflict(scope, cause)
        if (currentScope === scope) setErrorCause(browserState?.pending_dialog ? null : { cause })
      }
      return null
    } finally {
      if (currentScope === scope) setScreenshotLoading(false)
    }
  }

  const isCurrentPage = (candidate: { page_epoch: number; active_tab_id?: string }) =>
      matchesActiveBrowserPage(candidate, browserState)

  const changeProfile = (id: string, operation: "open" | "close", mode?: BrowserProfileMode, explicitClean = false): Promise<void> => {
    const previousScope = currentScope
    if (!previousScope || previousScope.sessionId !== id || previousScope.controller.signal.aborted ||
      profileFlights.has(id) || browserState?.pending_dialog || untrack(busy)) return Promise.resolve()
    if (operation === "close") {
      if (currentPhase !== "active" || readBrowserProfileReport(browserState).kind !== "reported") return Promise.resolve()
    } else {
      if (currentPhase !== "closed") return Promise.resolve()
      // A legacy404 is not a profile capability. The ordinary selector still
      // requires a report. A separate user action may request clean explicitly;
      // its ACK and canonical read must confirm the mode before it is shown.
      if (mode !== undefined && ((mode !== "shared" && mode !== "clean") ||
        (!profileReports.has(id) && !(explicitClean && mode === "clean")))) return Promise.resolve()
    }

    profileFailures.delete(id)
    const scope: Scope = { sessionId: id, controller: new AbortController() }
    currentScope = scope
    previousScope.controller.abort()
    stateVersion += 1
    mutationVersion += 1
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
        const failure = !isApiError(cause) || (cause.status >= 500 && !isBrowserBusy(cause) && !isSharedProfileUnsupported(cause))
          ? new BrowserProfileOutcomeUnknown("Browser operation outcome unconfirmed", { cause }) : cause
        profileFailures.set(id, failure)
      } finally {
        profileFlights.delete(id)
        // Ignore the write's raw ACK. A fresh GET is the only source of the
        // current chat view, including when A was left and selected again.
        if (currentScope?.sessionId === id) setRetryVersion((version) => version + 1)
      }
    })
    profileFlights.set(id, task)
    return task
  }
  const openProfile = (id: string, mode: BrowserProfileMode) => changeProfile(id, "open", mode)
  const openDefault = (id: string) => changeProfile(id, "open")
  const openClean = (id: string) => changeProfile(id, "open", "clean", true)
  const closeProfile = (id: string) => changeProfile(id, "close")

  createEffect(
    () => ({ intent: entryOpenVersion(), sessionId: sessionId(), active: active(), phase: profilePhase(), busy: busy() }),
    ({ sessionId, active, busy }) => {
      const request = entryOpen
      const scope = currentScope
      if (!request || !active || request.sessionId !== sessionId || !scope || scope.sessionId !== sessionId) return
      if (request.phase === "waiting") {
        if (profileFlights.has(request.sessionId) || actionsByScope.has(scope) || busy) return
        request.phase = "read"
        // Recheck a cached scope: it may have been closed elsewhere. A read
        // already in progress can serve the same intent without being restarted.
        if (initialReadPending !== scope) setRetryVersion((version) => version + 1)
        return
      }
      if (request.phase !== "read" || readScope !== scope || currentPhase !== "closed" ||
        profileFlights.has(request.sessionId) || busy) return
      request.phase = "opening"
      setEntryOpening(true)
      void changeProfile(request.sessionId, "open")
    },
  )

  const retry = () => {
    const id = sessionId()
    if (id) entryActionFailures.delete(id)
    setRetryVersion((version) => version + 1)
  }
  const hasPendingDialog = () => Boolean(browserState?.pending_dialog)

  return {
    get state() { return state() },
    get readySessionId() { return readySessionId() },
    get profile() { return profile() },
    get profilePhase() { return profilePhase() },
    requestEntryOpen,
    get entryOpening() { return entryOpening() },
    openProfile,
    openDefault,
    openClean,
    closeProfile,
    get frame() { return frame() },
    get dom() { return dom() },
    get loading() { return loading() },
    get busy() { return busy() },
    get domLoading() { return domLoading() },
    get screenshotLoading() { return screenshotLoading() },
    get error() { return error() },
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

export type BrowserSession = ReturnType<typeof createBrowserSession>
