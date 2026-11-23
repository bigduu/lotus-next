import { Plus, Trash2 } from "@lucide/solid"
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js"
import { settingsService, type EnvVarResponse } from "@services/config/SettingsService"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch"

export function SettingsEnv() {
  const text = createUiText()
  const secretId = createUniqueId()
  const [entries, setEntries] = createSignal<EnvVarResponse[]>([])
  const [revision, setRevision] = createSignal<number | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [operation, setOperation] = createSignal<"add" | "delete" | null>(null)
  const [name, setName] = createSignal("")
  const [value, setValue] = createSignal("")
  const [secret, setSecret] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let mounted = true
  let updating = false

  const applySnapshot = (snapshot: { entries: EnvVarResponse[]; revision: number }) => {
    if (!mounted) return
    setEntries(snapshot.entries)
    setRevision(snapshot.revision)
  }

  const reload = async () => {
    try {
      applySnapshot(await settingsService.getEnvVars())
      if (mounted) setError(null)
      return true
    } catch {
      if (mounted) {
        setRevision(null)
        setError(text("the_environment_variable_list_could_not_be_confirmed_re_4b274f7c"))
      }
      return false
    }
  }

  onSettled(() => {
    void reload().finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  })

  const mutate = async (kind: "add" | "delete", target: string) => {
    const expected = revision()
    if (!target || expected === null || updating) return
    updating = true
    setOperation(kind)
    setError(null)
    try {
      const snapshot = kind === "add"
        ? await settingsService.upsertEnvVar({ name: target, value: value(), secret: secret() }, expected)
        : await settingsService.deleteEnvVar(target, expected)
      applySnapshot(snapshot)
      if (mounted && kind === "add") {
        setName("")
        setValue("")
        setSecret(false)
      }
    } catch {
      const refreshed = mounted && await reload()
      if (mounted) {
        const labels = kind === "add"
          ? ["adding_failed_and_the_actual_list_could_not_be_refreshe_55bc8eea", "the_add_result_is_unconfirmed_the_actual_list_was_refre_0e0eb67c"] as const
          : ["deleting_failed_and_the_actual_list_could_not_be_refres_92130a73", "the_delete_result_is_unconfirmed_the_actual_list_was_re_3ab20d2d"] as const
        setError(text(labels[refreshed ? 1 : 0]))
      }
    } finally {
      updating = false
      if (mounted) setOperation(null)
    }
  }

  const unavailable = () => revision() === null || operation() !== null
  return (
    <div class="space-y-4">
      <p class="text-xs text-muted-foreground">{text("environment_variables_passed_to_the_backend_and_tools_v_0163420e")}</p>
      <form class="space-y-2 rounded-lg border p-3" onSubmit={(event) => {
        event.preventDefault()
        void mutate("add", name().trim())
      }}>
        <div class="text-xs font-medium text-muted-foreground">{text("add_variable_de177c5f")}</div>
        <Input aria-label={text("name_e_g_openai_api_key_b963e5a6")} placeholder={text("name_e_g_openai_api_key_b963e5a6")}
          value={name()} autocomplete="off" disabled={operation() !== null} onInput={(event) => setName(event.currentTarget.value)} />
        <Input aria-label={text("value_cda1d55c")} placeholder={text("value_cda1d55c")}
          type={secret() ? "password" : "text"} value={value()} autocomplete="off"
          disabled={operation() !== null} onInput={(event) => setValue(event.currentTarget.value)} />
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Switch id={secretId} checked={secret()} disabled={operation() !== null} onCheckedChange={setSecret} />
            <Label for={secretId} class="text-muted-foreground font-normal">{text("secret_masked_bf94b704")}</Label>
          </div>
          <Button size="sm" type="submit" disabled={!name().trim() || unavailable()}>
            <Plus class="size-4" />{text(operation() === "add" ? "adding_f470193b" : "add_7a8a11ea")}
          </Button>
        </div>
      </form>
      <Show when={error()}><p role="alert" class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error()}</p></Show>
      <section class="rounded-lg border p-3">
        <div class="mb-2 text-xs font-medium text-muted-foreground">{text("configured_e7284971")}{entries().length})</div>
        <Show when={!loading()} fallback={<p role="status" class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p>}>
          <Show when={entries().length > 0} fallback={<p class="text-xs text-muted-foreground">{text("none_yet_b336a174")}</p>}>
            <ul class="space-y-1.5">
              <For each={entries()} keyed={(entry) => entry.name}>{(entry) => (
                <li class="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="truncate font-mono text-xs">{entry().name}</span>
                      <Show when={entry().secret}>
                        <span class="rounded bg-muted px-1 text-[10px] text-muted-foreground">{text("secret_f67bca8f")}</span>
                      </Show>
                    </div>
                    <div class="truncate font-mono text-[11px] text-muted-foreground">
                      <Show when={entry().has_value} fallback={<span class="italic">{text("not_set_2f5f1d6f")}</span>}>
                        {entry().secret ? text("set_value_hidden_4e58023d") : entry().value}
                      </Show>
                    </div>
                  </div>
                  <button type="button" onClick={() => { void mutate("delete", entry().name) }} disabled={unavailable()}
                    aria-label={text("delete_4124e386", { v0: entry().name })}
                    class="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 class="size-3.5" />
                  </button>
                </li>
              )}</For>
            </ul>
          </Show>
        </Show>
      </section>
    </div>
  )
}
