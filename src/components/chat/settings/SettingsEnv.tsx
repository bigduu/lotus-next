import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { settingsService, type EnvVarResponse } from "@services/config/SettingsService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

export function SettingsEnv() {
  useUiLocale()
  const [entries, setEntries] = useState<EnvVarResponse[]>([])
  const [revision, setRevision] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [secret, setSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applySnapshot = useCallback((snapshot: { entries: EnvVarResponse[]; revision: number }) => {
    setEntries(snapshot.entries)
    setRevision(snapshot.revision)
  }, [])

  const reload = useCallback(async () => {
    try {
      const snapshot = await settingsService.getEnvVars()
      applySnapshot(snapshot)
      setError(null)
      return true
    } catch {
      setRevision(null)
      setError(uiText("the_environment_variable_list_could_not_be_confirmed_re_4b274f7c"))
      return false
    }
  }, [applySnapshot])

  useEffect(() => {
    void reload().finally(() => setLoading(false))
  }, [reload])

  const add = async () => {
    if (!name.trim() || revision === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const snapshot = await settingsService.upsertEnvVar(
        { name: name.trim(), value, secret },
        revision,
      )
      applySnapshot(snapshot)
      setName("")
      setValue("")
      setSecret(false)
    } catch {
      const refreshed = await reload()
      setError(
        refreshed
          ? uiText("the_add_result_is_unconfirmed_the_actual_list_was_refre_0e0eb67c")
          : uiText("adding_failed_and_the_actual_list_could_not_be_refreshe_55bc8eea"),
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async (n: string) => {
    if (revision === null || deleting !== null) return
    setDeleting(n)
    setError(null)
    try {
      const snapshot = await settingsService.deleteEnvVar(n, revision)
      applySnapshot(snapshot)
    } catch {
      const refreshed = await reload()
      setError(
        refreshed
          ? uiText("the_delete_result_is_unconfirmed_the_actual_list_was_re_3ab20d2d")
          : uiText("deleting_failed_and_the_actual_list_could_not_be_refres_92130a73"),
      )
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {uiText("environment_variables_passed_to_the_backend_and_tools_v_0163420e")}</p>

      <section className="space-y-2 rounded-lg border p-3">
        <div className="text-xs font-medium text-muted-foreground">{uiText("add_variable_de177c5f")}</div>
        <Input placeholder={uiText("name_e_g_openai_api_key_b963e5a6")} value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          placeholder={uiText("value_cda1d55c")}
          type={secret ? "password" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground font-normal">
            <Switch checked={secret} onCheckedChange={setSecret} />
            {uiText("secret_masked_bf94b704")}</Label>
          <Button size="sm" onClick={add} disabled={!name.trim() || revision === null || busy}>
            <Plus className="size-4" /> {busy ? uiText("adding_f470193b") : uiText("add_7a8a11ea")}
          </Button>
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("configured_e7284971")}{entries.length})</div>
        {loading ? (
          <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{uiText("none_yet_b336a174")}</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.name} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-xs">{e.name}</span>
                    {e.secret ? (
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{uiText("secret_f67bca8f")}</span>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {e.has_value ? (
                      e.secret ? uiText("set_value_hidden_4e58023d") : e.value
                    ) : (
                      <span className="italic">{uiText("not_set_2f5f1d6f")}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void remove(e.name)}
                  disabled={deleting !== null || revision === null}
                  aria-label={uiText("delete_4124e386", { v0: e.name })}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
