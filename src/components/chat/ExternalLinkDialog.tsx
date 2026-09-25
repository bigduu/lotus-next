import { createContext, useContext, useState, type ReactNode } from "react"
import { ChevronDown, Copy, ExternalLink, Globe2 } from "lucide-react"
import type { LinkSafetyModalProps } from "streamdown"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { copyText } from "@shared/utils/clipboard"
import { openExternalLink } from "@shared/utils/openExternalLink"

type OpenInApp = (url: string) => void | Promise<void>

const OpenInAppContext = createContext<OpenInApp | null>(null)

export function ExternalLinkProvider({
  children,
  onOpenInApp,
}: {
  children: ReactNode
  onOpenInApp?: OpenInApp
}) {
  return (
    <OpenInAppContext.Provider value={onOpenInApp ?? null}>
      {children}
    </OpenInAppContext.Provider>
  )
}

/** Streamdown's built-in confirm uses window.open, which cannot open Bodhi's default browser. */
export function ExternalLinkDialog({ url, isOpen, onClose }: LinkSafetyModalProps) {
  const openInApp = useContext(OpenInAppContext)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const perform = async (action: () => void | Promise<void>, failure: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-w-md" data-streamdown="link-safety-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="size-5" />
            打开外部链接？
          </DialogTitle>
          <DialogDescription>即将访问外部网站。</DialogDescription>
        </DialogHeader>
        <div className="max-h-32 overflow-y-auto break-all rounded-md bg-muted p-3 font-mono text-sm">
          {url}
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button
            className="min-w-0 flex-1"
            disabled={busy}
            variant="outline"
            onClick={() => void perform(() => copyText(url), "复制链接失败，请重试。")}
          >
            <Copy />
            复制链接
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button className="min-w-0 flex-1" disabled={busy}>
                打开链接
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48" style={{ zIndex: 60 }}>
              {openInApp ? (
                <DropdownMenuItem
                  onSelect={() => void perform(() => openInApp(url), "无法在应用内打开链接，请重试。")}
                >
                  <Globe2 />
                  在应用内打开
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onSelect={() => void perform(() => openExternalLink(url), "无法使用默认浏览器打开链接，请重试。")}
              >
                <ExternalLink />
                使用默认浏览器打开
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DialogContent>
    </Dialog>
  )
}
