import { createEffect, createMemo, createSignal, onSettled, Show, untrack } from "solid-js"
import { ArrowLeft, ArrowRight, Camera, Code2, ExternalLink, Globe2, LoaderCircle, RefreshCw, X } from "@lucide/solid"
import { matchesActiveBrowserPage, pointInBrowserFrame } from "@/lib/browserFrame"
import { normalizeBrowserAddress, playwrightKey } from "@/lib/browserInput"
import { FileOperationsService } from "@shared/services/FileOperationsService"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { BrowserProfileSelector, createBrowserProfileDraft } from "./BrowserProfileSelector"
import { createBrowserSession, type BrowserSession } from "./createBrowserSession"

const limitPromptText = (value: string): string => {
  if (value.length <= 4096) return value
  const bounded = value.slice(0, 4096)
  return /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded
}

const dialogSourceOrigin = (rawUrl: string, fallback: string): string => {
  try {
    const url = new URL(rawUrl)
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : fallback
  } catch {
    return fallback
  }
}

function canFocusBrowserControl(target: HTMLElement) {
  if (!target.isConnected || target.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  const foregroundModal = target.ownerDocument.activeElement?.closest('[aria-modal="true"]')
  return !foregroundModal || foregroundModal.contains(target)
}

interface BrowserPaneProps {
  sessionId: string | null
  active: boolean
}

export interface BrowserPaneViewProps extends BrowserPaneProps {
  newTabEntry?: boolean
  entryDraft?: string
  onEntryDraftChange?: (draft: string) => void
  onNewTabOpened?: () => void
  browser: BrowserSession
}

export function BrowserPane(props: BrowserPaneProps) {
  const browser = createBrowserSession(() => props.sessionId, () => props.active)
  return <BrowserPaneView sessionId={props.sessionId} active={props.active} browser={browser} />
}

export function BrowserPaneView(props: BrowserPaneViewProps) {
  const uiText = createUiText()
  const browser = () => props.browser
  const [address, setAddress] = createSignal("")
  const enteredAddress = () => props.newTabEntry ? props.entryDraft ?? address() : address()
  const profileDraft = createBrowserProfileDraft()
  const [addressError, setAddressError] = createSignal<string | null>(null)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [promptInput, setPromptInput] = createSignal<{ dialogId: string; value: string; edited: boolean } | null>(null)
  let saveGeneration = 0
  let viewportElement: HTMLDivElement | undefined
  let imageElement: HTMLImageElement | undefined
  let keyboardElement: HTMLTextAreaElement | undefined
  let dialogElement: HTMLDivElement | undefined
  let composing = false
  const currentState = () => browser().state
  const stateUrl = createMemo(() => currentState()?.url)
  const activeTabId = createMemo(() => currentState()?.active_tab_id)
  const pageEpoch = createMemo(() => currentState()?.page_epoch)
  const tabCount = createMemo(() => currentState()?.tabs?.length)
  const viewportWidth = createMemo(() => currentState()?.viewport.width)
  const viewportHeight = createMemo(() => currentState()?.viewport.height)
  const pendingDialog = createMemo(() => currentState()?.pending_dialog)
  const focusedDialogId = createMemo(() => props.active ? pendingDialog()?.dialog_id : undefined)
  const dialogBlocked = createMemo(() => Boolean(pendingDialog()))
  const controlsBlocked = () => browser().busy || dialogBlocked()
  const visibleFrame = createMemo(() => {
    const frame = browser().frame
    const dialog = pendingDialog()
    return frame && (matchesActiveBrowserPage(frame, currentState()) || dialog && frame.active_tab_id === dialog.tab_id)
      ? frame : null
  })

  createEffect(
    () => ({ url: stateUrl(), sessionId: props.sessionId, entry: props.newTabEntry }),
    ({ url, entry }) => { if (!entry) setAddress(url ?? "") },
  )
  createEffect(
    () => ({ sessionId: props.sessionId, entry: props.newTabEntry }),
    ({ entry }) => { if (entry) setAddress("") },
  )
  createEffect(
    () => ({ sessionId: props.sessionId, dialog: pendingDialog() }),
    ({ dialog, sessionId }, previous) => {
      if (dialog?.dialog_id === previous?.dialog?.dialog_id && dialog?.type === previous?.dialog?.type &&
        dialog?.default_value === previous?.dialog?.default_value && previous?.sessionId === sessionId) return
      setPromptInput(dialog?.type === "prompt"
        ? { dialogId: dialog.dialog_id, value: dialog.default_value, edited: false } : null)
    },
  )
  createEffect(
    focusedDialogId,
    (id) => {
      const dialog = dialogElement
      if (!id || !dialog || !canFocusBrowserControl(dialog)) return
      const document = dialog.ownerDocument
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const first = dialog.querySelector<HTMLElement>('textarea:not([disabled]),button:not([disabled])')
      ;(first ?? dialog).focus()
      return () => {
        if (dialog.contains(document.activeElement) && previous?.isConnected && !previous.matches(":disabled")) previous.focus()
      }
    },
  )
  createEffect(
    () => [props.sessionId, activeTabId(), pageEpoch()] as const,
    () => { saveGeneration += 1; setSaveError(null) },
  )
  onSettled(() => () => { saveGeneration += 1 })

  createEffect(
    () => ({
      sessionId: props.sessionId, active: props.active, entry: props.newTabEntry,
      tab: activeTabId(), tabCount: tabCount(),
      blocked: dialogBlocked(), width: viewportWidth(), height: viewportHeight(),
      sendViewport: browser().viewport,
    }),
    ({ sessionId, active, entry, tabCount, blocked, width, height, sendViewport }) => {
      const element = viewportElement
      if (!sessionId || !active || entry || tabCount === 0 || blocked || width === undefined || height === undefined || !element) return
      const view = element.ownerDocument.defaultView
      let timer: ReturnType<typeof setTimeout> | undefined
      const measure = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          const rect = element.getBoundingClientRect()
          if (rect.width < 160 || rect.height < 120) return
          const nextWidth = Math.min(1200, Math.max(320, Math.round(rect.width)))
          const nextHeight = Math.min(1000, Math.max(240, Math.round(rect.height)))
          if (nextWidth !== width || nextHeight !== height) void sendViewport({ width: nextWidth, height: nextHeight })
        }, 150)
      }
      measure()
      const Observer = view?.ResizeObserver
      if (Observer) {
        const observer = new Observer(measure)
        observer.observe(element)
        return () => { observer.disconnect(); clearTimeout(timer) }
      }
      view?.addEventListener("resize", measure)
      return () => { view?.removeEventListener("resize", measure); clearTimeout(timer) }
    },
  )

  const point = (clientX: number, clientY: number) => {
    const state = currentState()
    const frame = visibleFrame()
    if (controlsBlocked() || !frame || !state || !imageElement ||
      frame.viewport.width !== state.viewport.width || frame.viewport.height !== state.viewport.height) return null
    return pointInBrowserFrame(clientX, clientY, imageElement.getBoundingClientRect(), frame)
  }

  createEffect(
    () => ({ frame: visibleFrame(), send: browser().input }),
    ({ frame, send }) => {
      const element = viewportElement
      if (!element || !frame) return
      const wheel = (event: WheelEvent) => {
        if (!imageElement?.contains(event.target as Node)) return
        const location = point(event.clientX, event.clientY)
        if (!location) return
        event.preventDefault()
        void send({ kind: "scroll", ...location, delta_x: event.deltaX, delta_y: event.deltaY })
      }
      element.addEventListener("wheel", wheel, { passive: false })
      return () => element.removeEventListener("wheel", wheel)
    },
  )

  const navigate = (event: SubmitEvent) => {
    event.preventDefault()
    if (dialogBlocked()) return
    const url = normalizeBrowserAddress(enteredAddress())
    if (!url) { setAddressError(uiText("enter_a_valid_http_or_https_address_65ce84dd")); return }
    setAddressError(null)
    if (props.newTabEntry || currentState()?.tabs?.length === 0) {
      const id = props.sessionId
      void browser().openUrlInNewTab(url).then((opened) => {
        if (opened && props.sessionId === id) props.onNewTabOpened?.()
      })
    } else void browser().navigate(url)
  }

  const clickFrame = (event: MouseEvent) => {
    const location = point(event.clientX, event.clientY)
    if (!location) return
    event.preventDefault()
    keyboardElement?.focus({ preventScroll: true })
    const button = event.button === 2 ? "right" : event.button === 1 ? "middle" : "left"
    void browser().input({ kind: "click", ...location, button })
  }
  const typeText = (input: HTMLTextAreaElement) => {
    if (dialogBlocked() || composing || !input.value) return
    const text = input.value
    input.value = ""
    void browser().input({ kind: "type", text })
  }

  const saveScreenshot = async () => {
    if (dialogBlocked()) return
    const generation = saveGeneration
    setSaveError(null)
    const screenshot = await browser().captureScreenshot()
    if (!screenshot || generation !== saveGeneration || !browser().isCurrentPage(screenshot)) return
    try {
      const bytes = new Uint8Array(await screenshot.blob.arrayBuffer())
      if (generation !== saveGeneration || !browser().isCurrentPage(screenshot)) return
      const result = await FileOperationsService.saveBinaryFile(bytes,
        [{ name: uiText("jpeg_image_09e179c6"), extensions: ["jpg"] }],
        `browser-screenshot-${Date.now()}.jpg`,
      )
      if (generation === saveGeneration && !result.success && result.error !== "User cancelled save operation") {
        setSaveError(uiText("could_not_save_the_screenshot_please_try_again_589e0bf1"))
      }
    } catch {
      if (generation === saveGeneration) setSaveError(uiText("could_not_save_the_screenshot_please_try_again_589e0bf1"))
    }
  }

  const promptValue = (id: string) => {
    const prompt = promptInput()
    return prompt?.dialogId === id ? prompt : null
  }

  const dialogOverlay = () => (
    <Show when={pendingDialog()}>{(dialog) => (
        <div class="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-3" data-browser-dialog>
          <div ref={(element) => { dialogElement = element }} role="dialog" aria-modal="false" aria-label={uiText("web_dialog_c166882f")} tabindex={-1} class="flex max-h-full w-full max-w-md flex-col gap-3 overflow-auto rounded-lg border bg-card p-4 shadow-lg">
            <div class="text-sm font-semibold">
              {dialog().type === "alert" ? uiText("web_alert_f078f281") : dialog().type === "confirm" ? uiText("web_confirmation_f4482892") : uiText("web_prompt_98b13f4a")}
            </div>
            <p class="break-words text-xs text-muted-foreground">{uiText("from_9b6a4a82")} {dialogSourceOrigin(dialog().url, uiText("unknown_page_e238756f"))}</p>
            <p class="whitespace-pre-wrap break-words text-sm">{dialog().message}</p>
            {dialog().message_truncated ? <p class="text-xs text-muted-foreground">{uiText("the_web_prompt_has_been_truncated_97d4459c")}</p> : null}
            {dialog().type === "prompt" ? (
              <div class="flex flex-col gap-1">
                <label for="browser-dialog-prompt" class="text-xs text-muted-foreground">{uiText("input_6495aeb0")}</label>
                <textarea
                  id="browser-dialog-prompt"
                  aria-label={uiText("dialog_input_60abb58c")}
                  rows={3}
                  maxlength={4096}
                  disabled={browser().busy || dialog().status !== "pending"}
                  value={promptValue(dialog().dialog_id)?.value ?? dialog().default_value}
                  onInput={(event) => setPromptInput({
                    dialogId: dialog().dialog_id,
                    value: limitPromptText(event.currentTarget.value),
                    edited: true,
                  })}
                  class="w-full resize-none rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {dialog().default_value_truncated ? <p class="text-xs text-muted-foreground">{uiText("only_the_first_4_096_characters_are_shown_leaving_this__172c709d")}</p> : null}
              </div>
            ) : null}
            {dialog().status === "expired" ? (
              <p role="status" class="text-xs text-muted-foreground">{uiText("this_dialog_has_expired_refreshing_page_state_e1d48aa9")}</p>
            ) : (
              <div class="flex justify-end gap-2">
                {dialog().type !== "alert" ? (
                  <Button size="sm" variant="outline" disabled={browser().busy} onClick={() => void browser().respondDialog(false)}>{uiText("cancel_2cd0f3be")}</Button>
                ) : null}
                <Button
                  size="sm"
                  disabled={browser().busy}
                  onClick={() => void browser().respondDialog(true,
                    dialog().type === "prompt" && promptValue(dialog().dialog_id)?.edited
                      ? promptValue(dialog().dialog_id)?.value
                      : undefined)}
                >{uiText("ok_fac2a67a")}</Button>
              </div>
            )}
          </div>
        </div>
    )}</Show>
  )

  const profileControls = (session: string) => (
    <details class="w-full shrink-0 border-b p-2 text-sm" open={browser().profilePhase === "closed" ? true : undefined}>
      <summary class="cursor-pointer text-muted-foreground">{uiText("browser_profile_label")}</summary>
      <div class="pt-2"><BrowserProfileSelector
        sessionId={session} profile={browser().profilePhase === "unknown" ? { kind: "unreported" } : browser().profile} phase={browser().profilePhase === "closed" ? "closed" : "active"}
        nextMode={profileDraft.mode(session)}
        onNextModeChange={(mode) => { if (props.sessionId === session) profileDraft.select(session, mode) }}
        pending={browser().busy || browser().loading || dialogBlocked()}
        actions={browser().profilePhase === "unknown" ? undefined : { openDefault: (id) => { void browser().openDefault(id) }, openClean: (id) => { void browser().openClean(id) }, open: (id, mode) => { void browser().openProfile(id, mode) }, close: (id) => { void browser().closeProfile(id) } }}
      /></div>
    </details>
  )

  const waiting = (session: string) => (
      <section class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground" aria-label={uiText("built_in_browser_42d6809d")}>
        {!browser().entryOpening ? profileControls(session) : null}
        {browser().entryOpening || browser().loading ? <LoaderCircle class="size-5 animate-spin" aria-hidden="true" /> : browser().profilePhase === "closed" ? null : <Globe2 class="size-5" aria-hidden="true" />}
        {browser().entryOpening || browser().loading ? <p role="status">{uiText("starting_browser_30a20dd1")}</p> : browser().profilePhase !== "closed" ? <p role="status">{browser().error || uiText("connecting_to_browser_01a12061")}</p> : browser().error ? <p role="alert">{browser().error}</p> : null}
        {!browser().entryOpening && !browser().loading && (browser().error || browser().profilePhase === "closed") ? <Button size="sm" variant="outline" onClick={browser().retry}>{uiText("browser_profile_refresh")}</Button> : null}
      </section>
  )

  const entry = (session: string) => {
    let addressInput: HTMLInputElement | undefined
    onSettled(() => {
      if (untrack(() => props.active) && addressInput && canFocusBrowserControl(addressInput)) addressInput.focus({ preventScroll: true })
    })
    return (
      <section class="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6" aria-label={uiText("built_in_browser_42d6809d")} data-browser-empty="true">
        {profileControls(session)}
        <div class="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Globe2 aria-hidden="true" /></div>
        <div class="text-center">
          <h2 class="text-base font-medium">{browser().state?.tabs?.length ? uiText("open_a_new_page_1da8769a") : uiText("no_pages_open_yet_456d7ba7")}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{browser().state?.tabs?.length ? uiText("browser_create_tab") : uiText("browser_create_first_tab")}</p>
        </div>
        <form class="flex w-full max-w-md gap-2" onSubmit={navigate}>
          <input
            ref={(element) => { addressInput = element }}
            type="text"
            aria-label={uiText("page_address_eb6f944d")}
            value={enteredAddress()}
            onInput={(event) => {
              if (props.newTabEntry && props.onEntryDraftChange) props.onEntryDraftChange(event.currentTarget.value)
              else setAddress(event.currentTarget.value)
              setAddressError(null)
            }}
            placeholder="https://example.com"
            autocomplete="url"
            spellcheck={false}
            class="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" disabled={browser().busy}>{uiText("open_c771248e")}</Button>
        </form>
        {addressError() ? <p role="alert" class="text-sm text-destructive">{addressError()}</p> : null}
        {browser().error ? (
          <div role="alert" class="flex items-center gap-2 text-sm text-destructive">
            <span>{browser().error}</span>
            <Button size="sm" variant="outline" onClick={browser().retry}>{uiText("retry_b8784c8d")}</Button>
          </div>
        ) : null}
        {dialogOverlay()}
      </section>
    )
  }

  const page = (session: string) => (
    <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label={uiText("built_in_browser_42d6809d")} data-browser-pane="true">
      {profileControls(session)}
      <div class="flex shrink-0 items-center gap-1 border-b p-2">
        <Button size="icon" variant="ghost" aria-label={uiText("back_2d1d8c1e")} disabled={!browser().state?.can_go_back || controlsBlocked()} onClick={() => void browser().history("back")}>
          <ArrowLeft />
        </Button>
        <Button size="icon" variant="ghost" aria-label={uiText("forward_d681c6e2")} disabled={!browser().state?.can_go_forward || controlsBlocked()} onClick={() => void browser().history("forward")}>
          <ArrowRight />
        </Button>
        <Button size="icon" variant="ghost" aria-label={uiText("reload_page_9b316d54")} disabled={!browser().state || controlsBlocked()} onClick={() => void browser().history("reload")}>
          <RefreshCw class={browser().busy ? "animate-spin" : undefined} />
        </Button>
        <form class="flex min-w-0 flex-1 gap-1" onSubmit={navigate}>
          <input
            type="text"
            aria-label={uiText("page_address_eb6f944d")}
            value={address()}
            disabled={dialogBlocked()}
            onInput={(event) => {
              setAddress(event.currentTarget.value)
              setAddressError(null)
            }}
            placeholder={uiText("enter_a_url_abb7b877")}
            autocomplete="url"
            spellcheck={false}
            class="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="icon" variant="ghost" aria-label={uiText("go_to_page_1846b9b9")} disabled={!browser().state || controlsBlocked()} type="submit">
            <ExternalLink />
          </Button>
        </form>
      </div>

      <div class="flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs text-muted-foreground">
        <span class="min-w-0 flex-1 truncate" title={browser().state?.title || browser().state?.url || undefined}>
          {browser().state?.title || browser().state?.url || uiText("browser_e19c3b9e")}
        </span>
        <Button size="sm" variant="ghost" disabled={!browser().state || controlsBlocked() || browser().domLoading} onClick={() => void browser().inspectDom()} aria-label={uiText("view_dom_9d10b578")}>
          <Code2 /> DOM
        </Button>
        <Button size="sm" variant="ghost" disabled={!browser().state || dialogBlocked() || browser().screenshotLoading} aria-label={uiText("save_page_screenshot_d2b54d32")} onClick={() => void saveScreenshot()}>
          <Camera />{uiText("screenshot_c95dc99a")}</Button>
      </div>

      {addressError() ? <p role="alert" class="shrink-0 px-3 py-1 text-xs text-destructive">{addressError()}</p> : null}
      {saveError() ? <p role="alert" class="shrink-0 px-3 py-1 text-xs text-destructive">{saveError()}</p> : null}
      {browser().error ? (
        <div role="alert" class="flex shrink-0 items-center gap-2 border-b border-destructive px-3 py-2 text-xs text-destructive">
          <span class="min-w-0 flex-1">{browser().error}</span>
          <Button size="sm" variant="outline" onClick={browser().retry}>{uiText("retry_b8784c8d")}</Button>
        </div>
      ) : null}

      <div ref={(element) => { viewportElement = element }} class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted" data-browser-viewport>
        {visibleFrame() ? (
          <div class="absolute inset-0" onMouseDown={clickFrame} onContextMenu={(event) => event.preventDefault()}>
            <img
              ref={(element) => { imageElement = element }}
              src={visibleFrame()?.objectUrl}
              alt={uiText("page_view_f4d9add6")}
              draggable={false}
              class="h-full w-full select-none object-contain"
              data-browser-frame
            />
          </div>
        ) : (
          <div class="flex h-full items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground" role="status">
            {browser().loading ? <LoaderCircle class="size-4 animate-spin" /> : null}
            {browser().loading ? uiText("starting_browser_30a20dd1") : uiText("waiting_for_the_page_view_565bc1e5")}
          </div>
        )}

        <textarea
          ref={(element) => { keyboardElement = element }}
          aria-label={uiText("page_keyboard_input_98214c0a")}
          disabled={dialogBlocked()}
          class="absolute left-0 top-0 size-1 opacity-0"
          autocapitalize="off"
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => typeText(event.currentTarget)}
          onCompositionStart={() => { composing = true }}
          onCompositionEnd={(event) => {
            composing = false
            typeText(event.currentTarget)
          }}
          onKeyDown={(event) => {
            if (dialogBlocked()) return
            if (event.isComposing || composing) return
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return
            event.preventDefault()
            void browser().input({ kind: "key", key: playwrightKey(event) })
          }}
        />

        {browser().dom && !dialogBlocked() ? (
          <div class="absolute inset-0 z-10 flex min-h-0 flex-col rounded-lg border bg-card shadow-lg" aria-label={uiText("dom_snapshot_63cc6abc")}>
            <div class="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
              <span class="min-w-0 flex-1 truncate" title={browser().dom?.url}>DOM · {browser().dom?.title || browser().dom?.url}</span>
              <Button size="icon" variant="ghost" aria-label={uiText("close_dom_snapshot_6a788b13")} onClick={browser().clearDom}><X /></Button>
            </div>
            <pre class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">{browser().dom?.snapshot}</pre>
          </div>
        ) : null}

        {dialogOverlay()}
      </div>
    </section>
  )

  return (
    <Show when={props.sessionId} fallback={
      <div class="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {uiText("open_a_session_to_use_the_built_in_browser_4bc3811f")}
      </div>
    }>
      {(session) => (
        <Show when={currentState()} fallback={waiting(session())}>
          <Show when={props.newTabEntry || currentState()?.tabs?.length === 0} fallback={page(session())}>
            {entry(session())}
          </Show>
        </Show>
      )}
    </Show>
  )
}
