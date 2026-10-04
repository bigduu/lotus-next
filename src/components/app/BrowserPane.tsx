import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Code2,
  ExternalLink,
  Globe2,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useBrowserSession } from "@/hooks/useBrowserSession"
import { matchesActiveBrowserPage, pointInBrowserFrame } from "@/lib/browserFrame"
import { normalizeBrowserAddress, playwrightKey } from "@/lib/browserInput"
import { FileOperationsService } from "@/shared/services/FileOperationsService"

const limitPromptText = (value: string): string => {
  if (value.length <= 4096) return value
  const bounded = value.slice(0, 4096)
  return /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded
}

const dialogSourceOrigin = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl)
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : uiText("unknown_page_e238756f")
  } catch {
    return uiText("unknown_page_e238756f")
  }
}

export function BrowserPane({
  sessionId,
  active,
}: {
  sessionId: string | null
  active: boolean
}) {
  useUiLocale()
  const browser = useBrowserSession(sessionId, active)
  return <BrowserPaneView sessionId={sessionId} active={active} browser={browser} />
}

export function BrowserPaneView({
  sessionId,
  active,
  newTabEntry = false,
  entryDraft,
  onEntryDraftChange,
  onNewTabOpened,
  browser,
}: {
  sessionId: string | null
  active: boolean
  newTabEntry?: boolean
  entryDraft?: string
  onEntryDraftChange?: (draft: string) => void
  onNewTabOpened?: () => void
  browser: ReturnType<typeof useBrowserSession>
}) {
  useUiLocale()
  const [address, setAddress] = useState("")
  const enteredAddress = newTabEntry ? entryDraft ?? address : address
  const [addressError, setAddressError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [promptInput, setPromptInput] = useState<{ dialogId: string; value: string; edited: boolean } | null>(null)
  const saveGenerationRef = useRef(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const keyboardRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)
  const viewportWidth = browser.state?.viewport.width
  const viewportHeight = browser.state?.viewport.height
  const sendViewport = browser.viewport
  const sendInput = browser.input
  const currentFrame = browser.frame
  const pendingDialog = browser.state?.pending_dialog
  const pendingDialogId = pendingDialog?.dialog_id
  const dialogBlocked = Boolean(pendingDialog)
  const controlsBlocked = browser.busy || dialogBlocked
  const visibleFrame = currentFrame && (matchesActiveBrowserPage(currentFrame, browser.state) ||
    (pendingDialog && currentFrame.active_tab_id === pendingDialog.tab_id))
    ? currentFrame
    : null

  useEffect(() => {
    if (newTabEntry) return
    setAddress(browser.state?.url ?? "")
  }, [browser.state?.url, sessionId, newTabEntry])

  useEffect(() => {
    if (newTabEntry) setAddress("")
  }, [sessionId, newTabEntry])

  useEffect(() => {
    setPromptInput(pendingDialog?.type === "prompt"
      ? { dialogId: pendingDialog.dialog_id, value: pendingDialog.default_value, edited: false }
      : null)
  }, [sessionId, pendingDialog?.dialog_id, pendingDialog?.type, pendingDialog?.default_value])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!pendingDialogId || !dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = dialog.querySelector<HTMLElement>('textarea:not([disabled]),button:not([disabled])')
    ;(first ?? dialog).focus()
    return () => {
      // Keep focus in the composer or workbench if the person moved there.
      if (dialog.contains(document.activeElement) && previousFocus?.isConnected && !previousFocus.matches(":disabled")) {
        previousFocus.focus()
      }
    }
  }, [pendingDialogId])

  useEffect(() => {
    saveGenerationRef.current += 1
    setSaveError(null)
  }, [sessionId, browser.state?.active_tab_id, browser.state?.page_epoch])

  useEffect(() => {
    if (!sessionId || !active || newTabEntry || browser.state?.tabs?.length === 0 || dialogBlocked || viewportWidth === undefined || viewportHeight === undefined) return
    const element = viewportRef.current
    if (!element) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const measure = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const rect = element.getBoundingClientRect()
        if (rect.width < 160 || rect.height < 120) return
        const width = Math.min(1200, Math.max(320, Math.round(rect.width)))
        const height = Math.min(1000, Math.max(240, Math.round(rect.height)))
        if (width === viewportWidth && height === viewportHeight) return
        void sendViewport({ width, height })
      }, 150)
    }
    measure()
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure)
      observer.observe(element)
      return () => {
        observer.disconnect()
        if (timer) clearTimeout(timer)
      }
    }
    window.addEventListener("resize", measure)
    return () => {
      window.removeEventListener("resize", measure)
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, active, newTabEntry, browser.state?.active_tab_id, browser.state?.tabs?.length, dialogBlocked, viewportWidth, viewportHeight, sendViewport])

  const point = useCallback((clientX: number, clientY: number) => {
    const currentState = browser.state
    if (
      controlsBlocked ||
      !visibleFrame ||
      !currentState ||
      !imageRef.current ||
      visibleFrame.viewport.width !== currentState.viewport.width ||
      visibleFrame.viewport.height !== currentState.viewport.height
    ) return null
    return pointInBrowserFrame(
      clientX,
      clientY,
      imageRef.current.getBoundingClientRect(),
      visibleFrame,
    )
  }, [controlsBlocked, browser.state, visibleFrame])

  useEffect(() => {
    const element = viewportRef.current
    if (!element || !visibleFrame) return
    const wheel = (event: WheelEvent) => {
      if (!imageRef.current?.contains(event.target as Node)) return
      const location = point(event.clientX, event.clientY)
      if (!location) return
      event.preventDefault()
      void sendInput({
        kind: "scroll",
        ...location,
        delta_x: event.deltaX,
        delta_y: event.deltaY,
      })
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [visibleFrame, point, sendInput])

  const navigate = (event: FormEvent) => {
    event.preventDefault()
    if (dialogBlocked) return
    const url = normalizeBrowserAddress(enteredAddress)
    if (!url) {
      setAddressError(uiText("enter_a_valid_http_or_https_address_65ce84dd"))
      return
    }
    setAddressError(null)
    if (newTabEntry || browser.state?.tabs?.length === 0) {
      void browser.openUrlInNewTab(url).then((opened) => {
        if (opened) onNewTabOpened?.()
      })
    } else {
      void browser.navigate(url)
    }
  }

  const clickFrame = (event: MouseEvent<HTMLDivElement>) => {
    const location = point(event.clientX, event.clientY)
    if (!location) return
    event.preventDefault()
    keyboardRef.current?.focus({ preventScroll: true })
    const button = event.button === 2 ? "right" : event.button === 1 ? "middle" : "left"
    void browser.input({ kind: "click", ...location, button })
  }

  const typeText = (input: HTMLTextAreaElement) => {
    if (dialogBlocked || composingRef.current || !input.value) return
    const text = input.value
    input.value = ""
    void browser.input({ kind: "type", text })
  }

  const saveScreenshot = async () => {
    if (dialogBlocked) return
    const generation = saveGenerationRef.current
    setSaveError(null)
    const screenshot = await browser.captureScreenshot()
    if (!screenshot || generation !== saveGenerationRef.current || !browser.isCurrentPage(screenshot)) return
    try {
      const bytes = new Uint8Array(await screenshot.blob.arrayBuffer())
      if (generation !== saveGenerationRef.current || !browser.isCurrentPage(screenshot)) return
      const result = await FileOperationsService.saveBinaryFile(
        bytes,
        [{ name: uiText("jpeg_image_09e179c6"), extensions: ["jpg"] }],
        `browser-screenshot-${Date.now()}.jpg`,
      )
      if (generation === saveGenerationRef.current && !result.success && result.error !== "User cancelled save operation") {
        setSaveError(uiText("could_not_save_the_screenshot_please_try_again_589e0bf1"))
      }
    } catch {
      if (generation === saveGenerationRef.current) setSaveError(uiText("could_not_save_the_screenshot_please_try_again_589e0bf1"))
    }
  }

  const dialogOverlay = pendingDialog ? (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-3" data-browser-dialog>
      <div ref={dialogRef} role="dialog" aria-modal="false" aria-label={uiText("web_dialog_c166882f")} tabIndex={-1} className="flex max-h-full w-full max-w-md flex-col gap-3 overflow-auto rounded-lg border bg-card p-4 shadow-lg">
        <div className="text-sm font-semibold">
          {pendingDialog.type === "alert" ? uiText("web_alert_f078f281") : pendingDialog.type === "confirm" ? uiText("web_confirmation_f4482892") : uiText("web_prompt_98b13f4a")}
        </div>
        <p className="break-words text-xs text-muted-foreground">{uiText("from_9b6a4a82")} {dialogSourceOrigin(pendingDialog.url)}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{pendingDialog.message}</p>
        {pendingDialog.message_truncated ? <p className="text-xs text-muted-foreground">{uiText("the_web_prompt_has_been_truncated_97d4459c")}</p> : null}
        {pendingDialog.type === "prompt" ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="browser-dialog-prompt" className="text-xs text-muted-foreground">{uiText("input_6495aeb0")}</label>
            <textarea
              id="browser-dialog-prompt"
              aria-label={uiText("dialog_input_60abb58c")}
              rows={3}
              maxLength={4096}
              disabled={browser.busy || pendingDialog.status !== "pending"}
              value={promptInput?.dialogId === pendingDialog.dialog_id ? promptInput.value : pendingDialog.default_value}
              onChange={(event) => setPromptInput({
                dialogId: pendingDialog.dialog_id,
                value: limitPromptText(event.target.value),
                edited: true,
              })}
              className="w-full resize-none rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {pendingDialog.default_value_truncated ? <p className="text-xs text-muted-foreground">{uiText("only_the_first_4_096_characters_are_shown_leaving_this__172c709d")}</p> : null}
          </div>
        ) : null}
        {pendingDialog.status === "expired" ? (
          <p role="status" className="text-xs text-muted-foreground">{uiText("this_dialog_has_expired_refreshing_page_state_e1d48aa9")}</p>
        ) : (
          <div className="flex justify-end gap-2">
            {pendingDialog.type !== "alert" ? (
              <Button size="sm" variant="outline" disabled={browser.busy} onClick={() => void browser.respondDialog(false)}>{uiText("cancel_2cd0f3be")}</Button>
            ) : null}
            <Button
              size="sm"
              disabled={browser.busy}
              onClick={() => void browser.respondDialog(true,
                pendingDialog.type === "prompt" && promptInput?.dialogId === pendingDialog.dialog_id && promptInput.edited
                  ? promptInput.value
                  : undefined)}
            >{uiText("ok_fac2a67a")}</Button>
          </div>
        )}
      </div>
    </div>
  ) : null

  if (!sessionId) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {uiText("open_a_session_to_use_the_built_in_browser_4bc3811f")}</div>
    )
  }

  if (!browser.state) {
    return (
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground" aria-label={uiText("built_in_browser_42d6809d")}>
        {browser.loading ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Globe2 className="size-5" aria-hidden="true" />}
        <p role="status">{browser.loading ? uiText("starting_browser_30a20dd1") : browser.error || uiText("connecting_to_browser_01a12061")}</p>
        {!browser.loading && browser.error ? <Button size="sm" variant="outline" onClick={browser.retry}>{uiText("retry_b8784c8d")}</Button> : null}
      </section>
    )
  }

  if (newTabEntry || browser.state.tabs?.length === 0) {
    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6" aria-label={uiText("built_in_browser_42d6809d")} data-browser-empty>
        <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Globe2 aria-hidden="true" /></div>
        <div className="text-center">
          <h2 className="text-base font-medium">{browser.state.tabs?.length ? uiText("open_a_new_page_1da8769a") : uiText("no_pages_open_yet_456d7ba7")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{browser.state.tabs?.length ? uiText("browser_create_tab") : uiText("browser_create_first_tab")}</p>
        </div>
        <form className="flex w-full max-w-md gap-2" onSubmit={navigate}>
          <input
            type="text"
            aria-label={uiText("page_address_eb6f944d")}
            value={enteredAddress}
            onChange={(event) => {
              if (newTabEntry && onEntryDraftChange) onEntryDraftChange(event.target.value)
              else setAddress(event.target.value)
              setAddressError(null)
            }}
            placeholder="https://example.com"
            autoComplete="url"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            autoFocus={active}
          />
          <Button type="submit" disabled={browser.busy}>{uiText("open_c771248e")}</Button>
        </form>
        {addressError ? <p role="alert" className="text-sm text-destructive">{addressError}</p> : null}
        {browser.error ? (
          <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <span>{browser.error}</span>
            <Button size="sm" variant="outline" onClick={browser.retry}>{uiText("retry_b8784c8d")}</Button>
          </div>
        ) : null}
        {dialogOverlay}
      </section>
    )
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label={uiText("built_in_browser_42d6809d")} data-browser-pane>
      <div className="flex shrink-0 items-center gap-1 border-b p-2">
        <Button size="icon" variant="ghost" aria-label={uiText("back_2d1d8c1e")} disabled={!browser.state?.can_go_back || controlsBlocked} onClick={() => void browser.history("back")}>
          <ArrowLeft />
        </Button>
        <Button size="icon" variant="ghost" aria-label={uiText("forward_d681c6e2")} disabled={!browser.state?.can_go_forward || controlsBlocked} onClick={() => void browser.history("forward")}>
          <ArrowRight />
        </Button>
        <Button size="icon" variant="ghost" aria-label={uiText("reload_page_9b316d54")} disabled={!browser.state || controlsBlocked} onClick={() => void browser.history("reload")}>
          <RefreshCw className={browser.busy ? "animate-spin" : undefined} />
        </Button>
        <form className="flex min-w-0 flex-1 gap-1" onSubmit={navigate}>
          <input
            type="text"
            aria-label={uiText("page_address_eb6f944d")}
            value={address}
            disabled={dialogBlocked}
            onChange={(event) => {
              setAddress(event.target.value)
              setAddressError(null)
            }}
            placeholder={uiText("enter_a_url_abb7b877")}
            autoComplete="url"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="icon" variant="ghost" aria-label={uiText("go_to_page_1846b9b9")} disabled={!browser.state || controlsBlocked} type="submit">
            <ExternalLink />
          </Button>
        </form>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={browser.state?.title || browser.state?.url || undefined}>
          {browser.state?.title || browser.state?.url || uiText("browser_e19c3b9e")}
        </span>
        <Button size="sm" variant="ghost" disabled={!browser.state || controlsBlocked || browser.domLoading} onClick={() => void browser.inspectDom()} aria-label={uiText("view_dom_9d10b578")}>
          <Code2 /> DOM
        </Button>
        <Button size="sm" variant="ghost" disabled={!browser.state || dialogBlocked || browser.screenshotLoading} aria-label={uiText("save_page_screenshot_d2b54d32")} onClick={() => void saveScreenshot()}>
          <Camera />{uiText("screenshot_c95dc99a")}</Button>
      </div>

      {addressError ? <p role="alert" className="shrink-0 px-3 py-1 text-xs text-destructive">{addressError}</p> : null}
      {saveError ? <p role="alert" className="shrink-0 px-3 py-1 text-xs text-destructive">{saveError}</p> : null}
      {browser.error ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-destructive px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">{browser.error}</span>
          <Button size="sm" variant="outline" onClick={browser.retry}>{uiText("retry_b8784c8d")}</Button>
        </div>
      ) : null}

      <div ref={viewportRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted" data-browser-viewport>
        {visibleFrame ? (
          <div className="absolute inset-0" onMouseDown={clickFrame} onContextMenu={(event) => event.preventDefault()}>
            <img
              ref={imageRef}
              src={visibleFrame.objectUrl}
              alt={uiText("page_view_f4d9add6")}
              draggable={false}
              className="h-full w-full select-none object-contain"
              data-browser-frame
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground" role="status">
            {browser.loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {browser.loading ? uiText("starting_browser_30a20dd1") : uiText("waiting_for_the_page_view_565bc1e5")}
          </div>
        )}

        <textarea
          ref={keyboardRef}
          aria-label={uiText("page_keyboard_input_98214c0a")}
          disabled={dialogBlocked}
          className="absolute left-0 top-0 size-1 opacity-0"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => typeText(event.currentTarget)}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={(event) => {
            composingRef.current = false
            typeText(event.currentTarget)
          }}
          onKeyDown={(event) => {
            if (dialogBlocked) return
            if (event.nativeEvent.isComposing || composingRef.current) return
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return
            event.preventDefault()
            void browser.input({ kind: "key", key: playwrightKey(event) })
          }}
        />

        {browser.dom && !dialogBlocked ? (
          <div className="absolute inset-0 z-10 flex min-h-0 flex-col rounded-lg border bg-card shadow-lg" aria-label={uiText("dom_snapshot_63cc6abc")}>
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate" title={browser.dom.url}>DOM · {browser.dom.title || browser.dom.url}</span>
              <Button size="icon" variant="ghost" aria-label={uiText("close_dom_snapshot_6a788b13")} onClick={browser.clearDom}><X /></Button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">{browser.dom.snapshot}</pre>
          </div>
        ) : null}

        {dialogOverlay}
      </div>
    </section>
  )
}
