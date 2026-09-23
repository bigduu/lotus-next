import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Code2,
  ExternalLink,
  LoaderCircle,
  Plus,
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

export function BrowserPane({
  sessionId,
  active,
}: {
  sessionId: string | null
  active: boolean
}) {
  const browser = useBrowserSession(sessionId, active)
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
  const dialogBlocked = Boolean(pendingDialog)
  const controlsBlocked = browser.busy || dialogBlocked
  const visibleFrame = currentFrame && (matchesActiveBrowserPage(currentFrame, browser.state) ||
    (pendingDialog && currentFrame.active_tab_id === pendingDialog.tab_id))
    ? currentFrame
    : null
  const tabs = browser.state?.active_tab_id && browser.state.tabs
    ? browser.state.tabs
    : null

  useEffect(() => {
    setAddress(browser.state?.url ?? "")
  }, [browser.state?.url, sessionId])

  useEffect(() => {
    setPromptInput(pendingDialog?.type === "prompt"
      ? { dialogId: pendingDialog.dialog_id, value: pendingDialog.default_value, edited: false }
      : null)
  }, [sessionId, pendingDialog?.dialog_id, pendingDialog?.type, pendingDialog?.default_value])

  useEffect(() => {
    const modal = dialogRef.current
    if (!dialogBlocked || !modal) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusFirst = () => {
      const first = modal.querySelector<HTMLElement>('textarea:not([disabled]),button:not([disabled])')
      ;(first ?? modal).focus()
    }
    focusFirst()
    const containFocus = (event: FocusEvent) => {
      if (!modal.contains(event.target as Node)) focusFirst()
    }
    const blockOutsideKeys = (event: globalThis.KeyboardEvent) => {
      if (modal.contains(event.target as Node)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      focusFirst()
    }
    document.addEventListener("focusin", containFocus)
    document.addEventListener("keydown", blockOutsideKeys, true)
    return () => {
      document.removeEventListener("focusin", containFocus)
      document.removeEventListener("keydown", blockOutsideKeys, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [sessionId, dialogBlocked, pendingDialog?.dialog_id, pendingDialog?.status, pendingDialog?.type])

  const trapDialogTab = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key !== "Tab") return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('textarea:not([disabled]),button:not([disabled])') ?? [])
    if (!focusable.length) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const current = focusable.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current < 0 || current === focusable.length - 1 ? 0 : current + 1)
    event.preventDefault()
    focusable[next]?.focus()
  }

  useEffect(() => {
    saveGenerationRef.current += 1
    setSaveError(null)
  }, [sessionId, browser.state?.active_tab_id, browser.state?.page_epoch])

  useEffect(() => {
    if (!sessionId || !active || dialogBlocked || viewportWidth === undefined || viewportHeight === undefined) return
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
  }, [sessionId, active, dialogBlocked, viewportWidth, viewportHeight, sendViewport])

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
    void browser.navigate(url)
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

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label="内置浏览器" data-browser-pane>
      {tabs ? (
        <div className="flex min-w-0 shrink-0 items-center border-b bg-muted" aria-label="浏览器标签页">
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1" aria-label="浏览器标签列表">
            {tabs.map((tab, index) => {
              const label = tab.title || tab.url || "新标签页"
              const isActive = tab.tab_id === browser.state?.active_tab_id
              return (
                <div
                  key={tab.tab_id}
                  style={{ maxWidth: 176 }}
                  className={`flex h-8 shrink-0 items-center rounded-md border text-xs ${isActive ? "border-border bg-background text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:bg-muted"}`}
                >
                  <button
                    type="button"
                    aria-label={`切换到标签页 ${index + 1}：${label}`}
                    aria-current={isActive ? "page" : undefined}
                    title={label}
                    disabled={controlsBlocked || isActive}
                    className="h-full min-w-0 flex-1 truncate px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                    onClick={() => void browser.activateTab(tab.tab_id)}
                  >
                    {label}
                  </button>
                  <button
                    type="button"
                    aria-label={`关闭标签页 ${index + 1}：${label}`}
                    title={`关闭 ${label}`}
                    disabled={controlsBlocked}
                    className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    onClick={() => void browser.closeTab(tab.tab_id)}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </nav>
          <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="新建标签页" disabled={controlsBlocked} onClick={() => void browser.createTab()}>
            <Plus className="size-4" />
          </Button>
        </div>
      ) : null}
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
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="网页弹窗" tabIndex={-1} onKeyDown={trapDialogTab} className="flex max-h-full w-full max-w-md flex-col gap-3 overflow-auto rounded-lg border bg-card p-4 shadow-lg">
              <div className="text-sm font-semibold">
                {pendingDialog.type === "alert" ? "网页提示" : pendingDialog.type === "confirm" ? "网页确认" : "网页输入"}
              </div>
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
