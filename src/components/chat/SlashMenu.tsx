import { useEffect, useRef } from "react"
import type { SkillDefinition } from "@shared/types/skill"
import { cn } from "@/lib/utils"
import { useMenuKeyboardNav } from "./useMenuKeyboardNav"

/**
 * Slash-command picker shown above the composer when the draft starts with "/".
 * Lists skills filtered by the text after the slash; picking one (click or
 * ↑↓ + Enter/Tab) attaches it to the next send (selected_skill_ids); Escape
 * dismisses the menu without touching the draft.
 */
export function SlashMenu({
  skills,
  query,
  onPick,
  onDismiss,
}: {
  skills: SkillDefinition[]
  query: string
  onPick: (skill: SkillDefinition) => void
  onDismiss?: () => void
}) {
  const q = query.trim().toLowerCase()
  const filtered = skills
    .filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    )
    .slice(0, 8)

  const active = useMenuKeyboardNav(
    filtered.length,
    (i) => {
      const skill = filtered[i]
      if (skill) onPick(skill)
    },
    onDismiss,
  )
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (filtered.length === 0) return null

  return (
    <div className="mx-auto mb-2 max-w-2xl overflow-hidden rounded-xl border bg-popover shadow-lg">
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">技能</div>
      <div className="max-h-64 overflow-y-auto p-1">
        {filtered.map((s, i) => (
          <button
            key={s.id}
            ref={i === active ? activeItemRef : undefined}
            onClick={() => onPick(s)}
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
              i === active && "bg-accent",
            )}
          >
            <span className="text-sm font-medium">/{s.name}</span>
            {s.description ? (
              <span className="line-clamp-1 text-xs text-muted-foreground">{s.description}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}
