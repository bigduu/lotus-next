import type { SkillDefinition } from "@shared/types/skill"

/**
 * Slash-command picker shown above the composer when the draft starts with "/".
 * Lists skills filtered by the text after the slash; picking one attaches it to
 * the next send (selected_skill_ids).
 */
export function SlashMenu({
  skills,
  query,
  onPick,
}: {
  skills: SkillDefinition[]
  query: string
  onPick: (skill: SkillDefinition) => void
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

  if (filtered.length === 0) return null

  return (
    <div className="mx-auto mb-2 max-w-2xl overflow-hidden rounded-xl border bg-popover shadow-lg">
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">技能 / 工作流</div>
      <div className="max-h-64 overflow-y-auto p-1">
        {filtered.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick(s)}
            className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent"
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
