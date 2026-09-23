import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Code2,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useBrowserSession } from "@/hooks/useBrowserSession"
import { pointInBrowserFrame } from "@/lib/browserFrame"
import { normalizeBrowserAddress, playwrightKey } from "@/lib/browserInput"

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
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const keyboardRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const viewportWidth = browser.state?.viewport.width
  const viewportHeight = browser.state?.viewport.height
  const sendViewport = browser.viewport
  const sendInput = browser.input
  const currentFrame = browser.frame

  useEffect(() => {
    setAddress(browser.state?.url ?? "")
  }, [browser.state?.url, sessionId])

  useEffect(() => {
    if (!sessionId || !active || viewportWidth === undefined || viewportHeight === undefined) return
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
  }, [sessionId, active, viewportWidth, viewportHeight, sendViewport])

  const point = useCallback((clientX: number, clientY: number) => {
    const currentState = browser.state
    if (
      browser.busy ||
      !currentFrame ||
      !currentState ||
      !imageRef.current ||
      currentFrame.page_epoch !== currentState.page_epoch ||
      currentFrame.viewport.width !== currentState.viewport.width ||
      currentFrame.viewport.height !== currentState.viewport.height
    ) return null
    return pointInBrowserFrame(
      clientX,
      clientY,
      imageRef.current.getBoundingClientRect(),
      currentFrame,
    )
  }, [browser.busy, browser.state, currentFrame])

  useEffect(() => {
    const element = viewportRef.current
    if (!element || !currentFrame) return
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
  }, [currentFrame, point, sendInput])

  const navigate = (event: FormEvent) => {
    event.preventDefault()
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
    if (composingRef.current || !input.value) return
    const text = input.value
    input.value = ""
    void browser.input({ kind: "type", text })
  }

  const saveScreenshot = async () => {
    const screenshot = await browser.captureScreenshot()
    if (!screenshot) return
    const url = URL.createObjectURL(screenshot)
    const link = document.createElement("a")
    link.href = url
    link.download = `browser-screenshot-${Date.now()}.jpg`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
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
      <div className="flex shrink-0 items-center gap-1 border-b p-2">
        <Button size="icon" variant="ghost" aria-label="后退" disabled={!browser.state?.can_go_back || browser.busy} onClick={() => void browser.history("back")}>
          <ArrowLeft />
        </Button>
        <Button size="icon" variant="ghost" aria-label="前进" disabled={!browser.state?.can_go_forward || browser.busy} onClick={() => void browser.history("forward")}>
          <ArrowRight />
        </Button>
        <Button size="icon" variant="ghost" aria-label="刷新网页" disabled={!browser.state || browser.busy} onClick={() => void browser.history("reload")}>
          <RefreshCw className={browser.busy ? "animate-spin" : undefined} />
        </Button>
        <form className="flex min-w-0 flex-1 gap-1" onSubmit={navigate}>
          <input
            type="text"
            aria-label="网页地址"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setAddressError(null)
            }}
            placeholder="输入网址"
            autoComplete="url"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="icon" variant="ghost" aria-label="访问网页" disabled={!browser.state || browser.busy} type="submit">
            <ExternalLink />
          </Button>
        </form>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={browser.state?.title || browser.state?.url || undefined}>
          {browser.state?.title || browser.state?.url || "浏览器"}
        </span>
        <Button size="sm" variant="ghost" disabled={!browser.state || browser.busy || browser.domLoading} onClick={() => void browser.inspectDom()} aria-label="查看 DOM">
          <Code2 /> DOM
        </Button>
        <Button size="sm" variant="ghost" disabled={!browser.state || browser.screenshotLoading} aria-label="保存网页截图" onClick={() => void saveScreenshot()}>
          <Camera /> 截图
        </Button>
      </div>

      {addressError ? <p role="alert" className="shrink-0 px-3 py-1 text-xs text-destructive">{addressError}</p> : null}
      {browser.error ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-destructive px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">{browser.error}</span>
          <Button size="sm" variant="outline" onClick={browser.retry}>重试</Button>
        </div>
      ) : null}

      <div ref={viewportRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted" data-browser-viewport>
        {browser.frame ? (
          <div className="absolute inset-0" onMouseDown={clickFrame} onContextMenu={(event) => event.preventDefault()}>
            <img
              ref={imageRef}
              src={browser.frame.objectUrl}
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

        {browser.dom ? (
          <div className="absolute inset-0 z-10 flex min-h-0 flex-col rounded-lg border bg-card shadow-lg" aria-label="DOM 快照">
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate" title={browser.dom.url}>DOM · {browser.dom.title || browser.dom.url}</span>
              <Button size="icon" variant="ghost" aria-label="关闭 DOM 快照" onClick={browser.clearDom}><X /></Button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">{browser.dom.snapshot}</pre>
          </div>
        ) : null}
      </div>
    </section>
  )
}
