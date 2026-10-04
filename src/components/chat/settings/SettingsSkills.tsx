import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Search } from "lucide-react"
import { skillService } from "@services/skill/SkillService"
import type { SkillDefinition } from "@shared/types/skill"
import { useAppStore } from "@shared/store/appStore"
import { useBambooConfigStore } from "@shared/store/bambooConfigStore"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export function SettingsSkills() {
  useUiLocale()
  const config = useBambooConfigStore((s) => s.config)
  const loadConfig = useBambooConfigStore((s) => s.loadConfig)
  const saveConfig = useBambooConfigStore((s) => s.saveConfig)
  // Global list (feeds the composer slash menu) excludes disabled skills;
  // re-sync it after a toggle so the slash menu reflects the change.
  const refreshGlobalSkills = useAppStore((s) => s.loadSkills)

  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null)
  const [search, setSearch] = useState("")

  const disabledIds = useMemo(
    () => new Set((config?.skills?.disabled ?? []).map((v) => v.trim()).filter(Boolean)),
    [config],
  )

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true)
      setLoadError(null)
      try {
        const [res] = await Promise.all([
          skillService.listSkills({ includeDisabled: true }, refresh),
          loadConfig({ force: refresh }),
        ])
        setSkills(res.skills)
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : uiText("failed_to_load_skills_25d4f16d"))
      } finally {
        setLoading(false)
      }
    },
    [loadConfig],
  )

  useEffect(() => {
    void load(true)
  }, [load])

  const toggle = async (skill: SkillDefinition, enabled: boolean) => {
    setSavingId(skill.id)
    setSaveError(null)
    try {
      const latest = await loadConfig({ force: true })
      const current = latest?.skills?.disabled ?? []
      const next = Array.from(
        new Set(
          (enabled ? current.filter((v) => v !== skill.id) : [...current, skill.id])
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ).sort()
      // NARROW patch, never the whole GET body: echoing the redacted config
      // back would write mask strings into secrets the backend only
      // un-masks for provider api keys (e.g. cluster_fabric SSH keys).
      // model_limits must ride along explicitly — a POST without the key
      // DELETES model_limits.json (bamboo set.rs contract).
      await saveConfig({
        skills: { ...(latest?.skills ?? {}), disabled: next },
        ...(latest && (latest as { model_limits?: unknown }).model_limits !== undefined
          ? { model_limits: (latest as { model_limits?: unknown }).model_limits }
          : {}),
      } as Parameters<typeof saveConfig>[0])
      void refreshGlobalSkills()
    } catch (e) {
      setSaveError({
        id: skill.id,
        message: e instanceof Error ? e.message : uiText("failed_to_save_skill_state_369d373b"),
      })
    } finally {
      setSavingId(null)
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? skills.filter((s) =>
        [
          s.id,
          s.name,
          s.description,
          s.license ?? "",
          s.compatibility ?? "",
          ...(s.tool_refs ?? []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : skills

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {uiText("type_in_the_composer_dcfa53f6")} <code>/</code>{uiText("to_trigger_a_skill_disabled_skills_are_excluded_from_sy_fa49c48f")}</p>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          onClick={() => void load(true)}
          disabled={loading}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />{uiText("refresh_aee88743")}</Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder={uiText("search_skills_name_description_tools_7b0a1647")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}

      {loading && skills.length === 0 ? (
        <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {q ? uiText("no_skills_match_the_current_search_578e81dc") : uiText("no_skills_yet_990d5ec7")}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {uiText("total_76e547a8")} {skills.length} {uiText("skills_ac2141d1")} {disabledIds.size > 0 ? uiText("disabled_7f49fd2e", { v0: disabledIds.size }) : ""}
          </p>
          <ul className="space-y-2">
            {filtered.map((s) => {
              const disabled = disabledIds.has(s.id)
              return (
                <li key={s.id} className={cn("rounded-lg border p-3", disabled && "opacity-70")}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                    {disabled ? (
                      <Badge variant="outline" className="text-[10px]">
                        {uiText("disabled_bc5a87a7")}</Badge>
                    ) : null}
                    <Switch
                      checked={!disabled}
                      disabled={savingId === s.id}
                      onCheckedChange={(checked) => void toggle(s, checked)}
                      aria-label={disabled ? uiText("enable_57077dfa", { v0: s.name }) : uiText("disable_df52dc37", { v0: s.name })}
                    />
                  </div>
                  {s.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {s.description}
                    </p>
                  ) : null}
                  {s.license || s.compatibility || (s.tool_refs?.length ?? 0) > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {s.license ? (
                        <Badge variant="secondary" className="text-[10px]">
                          License: {s.license}
                        </Badge>
                      ) : null}
                      {s.compatibility ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {uiText("compatible_0225420a")} {s.compatibility}
                        </Badge>
                      ) : null}
                      {(s.tool_refs ?? []).map((ref) => (
                        <Badge
                          key={ref}
                          variant="outline"
                          className="text-[10px] font-normal text-muted-foreground"
                        >
                          {ref}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {saveError?.id === s.id ? (
                    <p className="mt-2 text-xs text-destructive">{saveError.message}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
