import { uiText, useUiLocale } from "@shared/i18n/ui"
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

const isWebUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

export function ExternalLinkProvider({
  children,
  onOpenInApp,
}: {
  children: ReactNode
  onOpenInApp?: OpenInApp
}) {
  useUiLocale()
  return (
    <OpenInAppContext.Provider value={onOpenInApp ?? null}>
      {children}
    </OpenInAppContext.Provider>
  )
}

/** Streamdown's built-in confirm uses window.open, which cannot open Bodhi's default browser. */
export function ExternalLinkDialog({ url, isOpen, onClose }: LinkSafetyModalProps) {
  useUiLocale()
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
            {uiText("open_external_link_fd407c70")}</DialogTitle>
          <DialogDescription>{uiText("you_are_about_to_visit_an_external_website_d5fdb530")}</DialogDescription>
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
            onClick={() => void perform(() => copyText(url), uiText("could_not_copy_link_please_try_again_c54af852"))}
          >
            <Copy />
            {uiText("copy_link_8e86f9b1")}</Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button className="min-w-0 flex-1" disabled={busy}>
                {uiText("open_link_a2639495")} <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48" style={{ zIndex: 60 }}>
              {openInApp && isWebUrl(url) ? (
                <DropdownMenuItem
                  onSelect={() => void perform(() => openInApp(url), uiText("could_not_open_the_link_in_the_app_please_try_again_769b498f"))}
                >
                  <Globe2 />
                  {uiText("open_in_app_af4b79db")}</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onSelect={() => void perform(() => openExternalLink(url), uiText("could_not_open_the_link_in_your_default_browser_please__14278433"))}
              >
                <ExternalLink />
                {uiText("open_in_default_browser_a489338a")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DialogContent>
    </Dialog>
  )
}
