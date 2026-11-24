import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { RefreshCw, Search } from "@lucide/solid"
import { apiClient } from "@services/api"
import { serviceFactory, type BambooConfig } from "@services/common/ServiceFactory"
import { skillService } from "@services/skill/SkillService"
import type { SkillDefinition } from "@shared/types/skill"
import { appStore } from "@shared/store/appStore/state"
import { bambooConfigStore } from "@shared/store/bambooConfigState"
import { cn } from "@/lib/utils"
import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Switch } from "../../ui/switch"

const disabledSkills = (config: BambooConfig | null) => {
  const entries = config?.skills?.disabled
  return new Set(Array.isArray(entries) ? entries.flatMap((id) =>
    typeof id === "string" && id.trim() ? [id.trim()] : []) : [])
}

let savingSkills = false

async function readBambooConfig(): Promise<BambooConfig> {
  // The shared convenience reader treats failed GETs as empty configuration.
  // A write needs the real GET result to carry forward the model-limit file.
  const config = await apiClient.get<BambooConfig>("bamboo/config")
  const disabled = config?.skills?.disabled
  if (!config || typeof config !== "object" || Array.isArray(config)
    || (config.skills !== undefined && (!config.skills || typeof config.skills !== "object" || Array.isArray(config.skills)))
    || (disabled !== undefined && (!Array.isArray(disabled) || !disabled.every((id) => typeof id === "string")))) {
    throw new Error("Invalid Bamboo skill settings")
  }
  return config
}

const rememberConfig = (config: BambooConfig) => bambooConfigStore.setState({
  config, lastLoadedAt: Date.now(), error: null,
})

export function SettingsSkills() {
  const text = createUiText()
  const config = createStoreSelector(bambooConfigStore, (state) => state.config)
  const [skills, setSkills] = createSignal<SkillDefinition[]>([])
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [savingId, setSavingId] = createSignal<string | null>(null)
  const [saveError, setSaveError] = createSignal<{ id: string; message: string } | null>(null)
  const [search, setSearch] = createSignal("")
  let mounted = true
  let reading = false
  const disabledIds = createMemo(() => disabledSkills(config()))
  const query = createMemo(() => search().trim().toLowerCase())
  const filtered = createMemo(() => {
    const q = query()
    if (!q) return skills()
    return skills().filter((skill) => [
      skill.id, skill.name, skill.description, skill.license, skill.compatibility, ...(skill.tool_refs ?? []),
    ].join(" ").toLowerCase().includes(q))
  })

  const load = async () => {
    if (reading) return
    reading = true
    setLoading(true)
    setLoadError(null)
    try {
      const [result, latest] = await Promise.all([skillService.listSkills({ includeDisabled: true }, true), readBambooConfig()])
      if (!mounted) return
      rememberConfig(latest)
      setSkills(result.skills)
    } catch {
      if (mounted) setLoadError(text("failed_to_load_skills_25d4f16d"))
    } finally {
      reading = false
      if (mounted) setLoading(false)
    }
  }

  onSettled(() => {
    void load()
    return () => { mounted = false }
  })

  const toggle = async (skill: SkillDefinition, enabled: boolean) => {
    if (savingSkills || reading) return
    savingSkills = true
    setSavingId(skill.id)
    setSaveError(null)
    try {
      const latest = await readBambooConfig()
      if (!mounted) return
      const disabled = disabledSkills(latest)
      if (enabled === !disabled.has(skill.id)) {
        rememberConfig(latest)
        return
      }
      if (enabled) disabled.delete(skill.id)
      else disabled.add(skill.id)

      // Config is redacted on GET. Only submit the edited section plus the
      // explicitly retained model limits, which the backend deletes if absent.
      await serviceFactory.setBambooConfig({
        skills: { ...latest.skills, disabled: [...disabled].sort() },
        ...(latest.model_limits === undefined ? {} : { model_limits: latest.model_limits }),
      })
      const verified = await readBambooConfig()
      if (disabledSkills(verified).has(skill.id) === enabled) throw new Error("Unconfirmed skill state")
      rememberConfig(verified)
      // The active slash menu uses the enabled-only list.
      void appStore.getState().loadSkills()
    } catch {
      if (mounted) setSaveError({ id: skill.id, message: text("failed_to_save_skill_state_369d373b") })
    } finally {
      savingSkills = false
      if (mounted) setSavingId(null)
    }
  }

  return (
    <div class="space-y-3">
      <div class="flex items-start justify-between gap-2">
        <p class="text-xs leading-relaxed text-muted-foreground">
          {text("type_in_the_composer_dcfa53f6")} <code>/</code>{text("to_trigger_a_skill_disabled_skills_are_excluded_from_sy_fa49c48f")}
        </p>
        <Button size="sm" variant="secondary" class="shrink-0" onClick={() => void load()} disabled={loading() || savingId() !== null}>
          <RefreshCw class={cn("size-4", loading() && "animate-spin")} />{text("refresh_aee88743")}
        </Button>
      </div>
      <div class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input class="pl-8" aria-label={text("search_skills_name_description_tools_7b0a1647")}
          placeholder={text("search_skills_name_description_tools_7b0a1647")} value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)} />
      </div>
      <Show when={loadError()}>
        <p role="alert" class="text-xs text-destructive">{loadError()}</p>
      </Show>
      <Show when={!(loading() && skills().length === 0)} fallback={
        <p role="status" class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p>
      }>
        <Show when={filtered().length > 0} fallback={
          <p class="text-xs text-muted-foreground">{text(query() ? "no_skills_match_the_current_search_578e81dc" : "no_skills_yet_990d5ec7")}</p>
        }>
          <p class="text-xs text-muted-foreground">
            {text("total_76e547a8")} {skills().length} {text("skills_ac2141d1")} {disabledIds().size > 0 ? text("disabled_7f49fd2e", { v0: disabledIds().size }) : ""}
          </p>
          <ul class="space-y-2">
            <For each={filtered()} keyed={(skill: SkillDefinition) => skill.id}>
              {(skill) => {
                const disabled = () => disabledIds().has(skill().id)
                return (
                  <li class={cn("rounded-lg border p-3", disabled() && "opacity-70")}>
                    <div class="flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate font-medium">{skill().name}</span>
                      <Show when={disabled()}>
                        <Badge variant="outline" class="text-[10px]">{text("disabled_bc5a87a7")}</Badge>
                      </Show>
                      <Switch checked={!disabled()} disabled={loading() || savingId() !== null}
                        aria-label={text(disabled() ? "enable_57077dfa" : "disable_df52dc37", { v0: skill().name })}
                        onCheckedChange={(enabled) => void toggle(skill(), enabled)} />
                    </div>
                    <Show when={skill().description}>
                      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{skill().description}</p>
                    </Show>
                    <Show when={skill().license || skill().compatibility || (skill().tool_refs?.length ?? 0) > 0}>
                      <div class="mt-2 flex flex-wrap items-center gap-1">
                        <Show when={skill().license}>
                          <Badge variant="secondary" class="text-[10px]">License: {skill().license}</Badge>
                        </Show>
                        <Show when={skill().compatibility}>
                          <Badge variant="secondary" class="text-[10px]">{text("compatible_0225420a")} {skill().compatibility}</Badge>
                        </Show>
                        <For each={skill().tool_refs ?? []}>
                          {(ref) => <Badge variant="outline" class="text-[10px] font-normal text-muted-foreground">{ref}</Badge>}
                        </For>
                      </div>
                    </Show>
                    <Show when={saveError()?.id === skill().id}>
                      <p role="alert" class="mt-2 text-xs text-destructive">{saveError()?.message}</p>
                    </Show>
                  </li>
                )
              }}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  )
}
