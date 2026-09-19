import { useRef, useState } from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"

/**
 * Composer model switcher — a pill that opens a clean checkmark menu (upward,
 * since it sits above the composer). Replaces the plain native <select>.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  menuPlacement = "up",
  menuAlign = "left",
}: {
  models: string[]
  value: string
  onChange: (model: string) => void
  menuPlacement?: "up" | "down"
  menuAlign?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  if (models.length === 0) return null

  const normalizedQuery = query.trim().toLowerCase()
  const filteredModels = normalizedQuery
    ? models.filter((model) => model.toLowerCase().includes(normalizedQuery))
    : models

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setQuery("")
  }

  const pickModel = (model: string) => {
    onChange(model)
    changeOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-[70vw] items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 md:max-w-xs"
        >
          <span className="truncate">{value || "选择模型"}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={menuPlacement === "up" ? "top" : "bottom"}
        align={menuAlign === "right" ? "end" : "start"}
        className="w-72 max-w-[90vw] rounded-2xl p-1"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchRef.current?.focus()
        }}
      >
        <div className="relative m-1 mb-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchRef}
            type="text"
            role="searchbox"
            aria-label="搜索模型"
            placeholder="搜索模型…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="h-8 pl-8 pr-8 text-xs"
          />
          {query ? (
            <button
              type="button"
              aria-label="清空模型搜索"
              onClick={() => {
                setQuery("")
                searchRef.current?.focus()
              }}
              className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <div className="max-h-60 overflow-y-auto p-1" aria-label="模型列表">
          {filteredModels.length > 0 ? filteredModels.map((model) => (
            <button
              key={model}
              type="button"
              data-model-option
              aria-pressed={model === value}
              onClick={() => pickModel(model)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <Check
                className={cn(
                  "size-4 shrink-0 text-primary",
                  model === value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className={cn("truncate", model === value && "font-medium")}>
                {model}
              </span>
            </button>
          )) : (
            <p role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">
              没有匹配的模型
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
