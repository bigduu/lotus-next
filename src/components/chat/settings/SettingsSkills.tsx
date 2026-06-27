import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { useAppStore } from "@shared/store/appStore"

export function SettingsSkills() {
  const skills = useAppStore(useShallow((s) => s.skills))
  const loadSkills = useAppStore((s) => s.loadSkills)

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        在输入框输入 <code>/</code> 触发技能。当前可用 {skills.length} 个:
      </p>
      {skills.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无技能</p>
      ) : (
        <ul className="space-y-2">
          {skills.map((s) => (
            <li key={s.id} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="font-medium">{s.name}</span>
                {s.tool_refs?.length ? (
                  <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                    {s.tool_refs.length} 工具
                  </span>
                ) : null}
              </div>
              {s.description ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
