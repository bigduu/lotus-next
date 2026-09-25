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
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "未知网页"
  } catch {
    return "未知网页"
  }
}

export function BrowserPane({
  sessionId,
  active,
}: {
  sessionId: string | null
  active: boolean
}) {
  const browser = useBrowserSession(sessionId, active)
  return <BrowserPaneView sessionId={sessionId} active={active} browser={browser} />
}

export function BrowserPaneView({
  sessionId,
  active,
  newTabEntry = false,
  onNewTabOpened,
  browser,
}: {
  sessionId: string | null
  active: boolean
  newTabEntry?: boolean
  onNewTabOpened?: () => void
  browser: ReturnType<typeof useBrowserSession>
}) {
  const [address, setAddress] = useState("")
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
    if (!sessionId || !active || newTabEntry || !browser.state?.active_tab_id || dialogBlocked || viewportWidth === undefined || viewportHeight === undefined) return
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
  }, [sessionId, active, newTabEntry, browser.state?.active_tab_id, dialogBlocked, viewportWidth, viewportHeight, sendViewport])

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
    const url = normalizeBrowserAddress(address)
    if (!url) {
      setAddressError("请输入有效的 http 或 https 地址。")
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
        [{ name: "JPEG 图像", extensions: ["jpg"] }],
        `browser-screenshot-${Date.now()}.jpg`,
      )
      if (generation === saveGenerationRef.current && !result.success && result.error !== "User cancelled save operation") {
        setSaveError("保存截图失败，请重试。")
      }
    } catch {
      if (generation === saveGenerationRef.current) setSaveError("保存截图失败，请重试。")
    }
  }

  if (!sessionId) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        打开一个会话后即可使用内置浏览器。
      </div>
    )
  }

  if (!browser.state) {
    return (
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground" aria-label="内置浏览器">
        {browser.loading ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Globe2 className="size-5" aria-hidden="true" />}
        <p role="status">{browser.loading ? "正在启动浏览器…" : browser.error || "正在连接浏览器…"}</p>
        {!browser.loading && browser.error ? <Button size="sm" variant="outline" onClick={browser.retry}>重试</Button> : null}
      </section>
    )
  }

  if (newTabEntry || browser.state.tabs?.length === 0) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6" aria-label="内置浏览器" data-browser-empty>
        <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Globe2 aria-hidden="true" /></div>
        <div className="text-center">
          <h2 className="text-base font-medium">{browser.state.tabs?.length ? "打开新网页" : "还没有打开网页"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">输入网址后创建{browser.state.tabs?.length ? "新" : "第一个"}标签页</p>
        </div>
        <form className="flex w-full max-w-md gap-2" onSubmit={navigate}>
          <input
            type="text"
            aria-label="网页地址"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setAddressError(null)
            }}
            placeholder="https://example.com"
            autoComplete="url"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            autoFocus={active}
          />
          <Button type="submit" disabled={browser.busy}>打开</Button>
        </form>
        {addressError ? <p role="alert" className="text-sm text-destructive">{addressError}</p> : null}
        {browser.error ? <p role="alert" className="text-sm text-destructive">{browser.error}</p> : null}
      </section>
    )
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label="内置浏览器" data-browser-pane>
      <div className="flex shrink-0 items-center gap-1 border-b p-2">
        <Button size="icon" variant="ghost" aria-label="后退" disabled={!browser.state?.can_go_back || controlsBlocked} onClick={() => void browser.history("back")}>
          <ArrowLeft />
        </Button>
        <Button size="icon" variant="ghost" aria-label="前进" disabled={!browser.state?.can_go_forward || controlsBlocked} onClick={() => void browser.history("forward")}>
          <ArrowRight />
        </Button>
        <Button size="icon" variant="ghost" aria-label="刷新网页" disabled={!browser.state || controlsBlocked} onClick={() => void browser.history("reload")}>
          <RefreshCw className={browser.busy ? "animate-spin" : undefined} />
        </Button>
        <form className="flex min-w-0 flex-1 gap-1" onSubmit={navigate}>
          <input
            type="text"
            aria-label="网页地址"
            value={address}
            disabled={dialogBlocked}
            onChange={(event) => {
              setAddress(event.target.value)
              setAddressError(null)
            }}
            placeholder="输入网址"
            autoComplete="url"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="icon" variant="ghost" aria-label="访问网页" disabled={!browser.state || controlsBlocked} type="submit">
            <ExternalLink />
          </Button>
        </form>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={browser.state?.title || browser.state?.url || undefined}>
          {browser.state?.title || browser.state?.url || "浏览器"}
        </span>
        <Button size="sm" variant="ghost" disabled={!browser.state || controlsBlocked || browser.domLoading} onClick={() => void browser.inspectDom()} aria-label="查看 DOM">
          <Code2 /> DOM
        </Button>
        <Button size="sm" variant="ghost" disabled={!browser.state || dialogBlocked || browser.screenshotLoading} aria-label="保存网页截图" onClick={() => void saveScreenshot()}>
          <Camera /> 截图
        </Button>
      </div>

      {addressError ? <p role="alert" className="shrink-0 px-3 py-1 text-xs text-destructive">{addressError}</p> : null}
      {saveError ? <p role="alert" className="shrink-0 px-3 py-1 text-xs text-destructive">{saveError}</p> : null}
      {browser.error ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-destructive px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">{browser.error}</span>
          <Button size="sm" variant="outline" onClick={browser.retry}>重试</Button>
        </div>
      ) : null}

      <div ref={viewportRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted" data-browser-viewport>
        {visibleFrame ? (
          <div className="absolute inset-0" onMouseDown={clickFrame} onContextMenu={(event) => event.preventDefault()}>
            <img
              ref={imageRef}
              src={visibleFrame.objectUrl}
              alt="网页画面"
              draggable={false}
              className="h-full w-full select-none object-contain"
              data-browser-frame
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground" role="status">
            {browser.loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {browser.loading ? "正在启动浏览器…" : "等待网页画面…"}
          </div>
        )}

        <textarea
          ref={keyboardRef}
          aria-label="网页键盘输入"
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
          <div className="absolute inset-0 z-10 flex min-h-0 flex-col rounded-lg border bg-card shadow-lg" aria-label="DOM 快照">
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate" title={browser.dom.url}>DOM · {browser.dom.title || browser.dom.url}</span>
              <Button size="icon" variant="ghost" aria-label="关闭 DOM 快照" onClick={browser.clearDom}><X /></Button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">{browser.dom.snapshot}</pre>
          </div>
        ) : null}

        {pendingDialog ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-3" data-browser-dialog>
            <div ref={dialogRef} role="dialog" aria-modal="false" aria-label="网页弹窗" tabIndex={-1} className="flex max-h-full w-full max-w-md flex-col gap-3 overflow-auto rounded-lg border bg-card p-4 shadow-lg">
              <div className="text-sm font-semibold">
                {pendingDialog.type === "alert" ? "网页提示" : pendingDialog.type === "confirm" ? "网页确认" : "网页输入"}
              </div>
              <p className="break-words text-xs text-muted-foreground">来自 {dialogSourceOrigin(pendingDialog.url)}</p>
              <p className="whitespace-pre-wrap break-words text-sm">{pendingDialog.message}</p>
              {pendingDialog.message_truncated ? <p className="text-xs text-muted-foreground">网页提示内容已截断。</p> : null}
              {pendingDialog.type === "prompt" ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor="browser-dialog-prompt" className="text-xs text-muted-foreground">输入内容</label>
                  <textarea
                    id="browser-dialog-prompt"
                    aria-label="弹窗输入"
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
                  {pendingDialog.default_value_truncated ? <p className="text-xs text-muted-foreground">默认内容仅显示前 4096 字；保持不改将使用网页的完整默认值。</p> : null}
                </div>
              ) : null}
              {pendingDialog.status === "expired" ? (
                <p role="status" className="text-xs text-muted-foreground">弹窗已过期，正在刷新网页状态…</p>
              ) : (
                <div className="flex justify-end gap-2">
                  {pendingDialog.type !== "alert" ? (
                    <Button size="sm" variant="outline" disabled={browser.busy} onClick={() => void browser.respondDialog(false)}>取消</Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={browser.busy}
                    onClick={() => void browser.respondDialog(true,
                      pendingDialog.type === "prompt" && promptInput?.dialogId === pendingDialog.dialog_id && promptInput.edited
                        ? promptInput.value
                        : undefined)}
                  >确定</Button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
