import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { getErrorMessage } from "@services/api"
import { serviceFactory } from "@services/common/ServiceFactory"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { StatusLine } from "./StatusLine"
import type { SectionMessage, SystemBambooConfig, WorkFeatureFlags } from "./useSystemConfig"

const controls = [
  { flag: "ticket_mutation", label: "work_settings_mutation", description: "work_settings_mutation_description" },
  { flag: "ticket_dispatch", label: "work_settings_dispatch", description: "work_settings_dispatch_description" },
] as const

export function SectionWork({ flags }: { flags: WorkFeatureFlags }) {
  useUiLocale()
  const id = useId()
  const [savedFlags, setSavedFlags] = useState(flags)
  const [draft, setDraft] = useState(flags)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<SectionMessage>(null)

  const changes: Partial<WorkFeatureFlags> = {}
  for (const { flag } of controls) {
    if (draft[flag] !== savedFlags[flag]) changes[flag] = draft[flag]
  }
  const dirty = Object.keys(changes).length > 0

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const response: SystemBambooConfig = await serviceFactory.setBambooConfig({ features: changes })
      const confirmed = response.features
      if (typeof confirmed?.ticket_mutation !== "boolean" || typeof confirmed.ticket_dispatch !== "boolean"
        || controls.some(({ flag }) => changes[flag] !== undefined && confirmed[flag] !== changes[flag])) {
        throw new Error(uiText("work_settings_unconfirmed"))
      }
      const next = { ticket_mutation: confirmed.ticket_mutation, ticket_dispatch: confirmed.ticket_dispatch }
      setSavedFlags(next)
      setDraft(next)
      setMessage({ kind: "ok", text: uiText("saved_1bd91a7d") })
    } catch (error) {
      setMessage({ kind: "error", text: getErrorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby={id} className="space-y-3 rounded-lg border p-3">
      <div id={id} className="text-xs font-medium text-muted-foreground">
        {uiText("supervisor_work_tab")}
      </div>
      {controls.map(({ flag, label, description }) => {
        const switchId = `${id}-${flag}`
        return (
          <div key={flag} className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <label htmlFor={switchId} className="block text-sm">{uiText(label)}</label>
              <p id={`${switchId}-description`} className="text-xs leading-relaxed text-muted-foreground">
                {uiText(description)}
              </p>
            </div>
            <Switch
              id={switchId}
              aria-describedby={`${switchId}-description`}
              checked={draft[flag]}
              disabled={saving}
              onCheckedChange={(checked) => {
                setDraft((previous) => ({ ...previous, [flag]: checked }))
                setMessage(null)
              }}
            />
          </div>
        )
      })}
      <div className="flex items-center justify-between gap-2">
        <div aria-live="polite"><StatusLine msg={message} /></div>
        <Button size="sm" className="ml-auto" onClick={save} disabled={saving || !dirty}>
          {uiText(saving ? "saving_ff509c9b" : "save_a3030bf8")}
        </Button>
      </div>
    </section>
  )
}
