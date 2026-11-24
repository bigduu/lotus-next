import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { publisherChangeConfirmed, publisherPolicyService, type PublisherPolicy, type PublisherPolicyChange } from "@services/plugin"
import { isApiError } from "@services/api"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Badge } from "../../ui/badge"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../../ui/responsive-dialog"

interface Review { policy: PublisherPolicy; change: PublisherPolicyChange }
interface Props {
  disabled: boolean
  observedRevision?: number
  onBegin: () => boolean
  onEnd: () => Promise<unknown>
}

export function PublisherTrustPanel(props: Props) {
  const uiText = createUiText()
  const [policy, setPolicy] = createSignal<PublisherPolicy | null>(null)
  const [legacy, setLegacy] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  const [reading, setReading] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  const [readError, setReadError] = createSignal(false)
  const [message, setMessage] = createSignal<string | null>(null)
  const [review, setReview] = createSignal<Review | null>(null)
  let alive = true
  let generation = 0
  let posting = false
  let intent: Review | null = null
  onCleanup(() => { alive = false; generation += 1 })

  const load = async () => {
    if (!alive) return
    const current = ++generation
    setReading(true)
    try {
      const fresh = await publisherPolicyService.get()
      if (!alive || current !== generation) return
      setPolicy(fresh)
      setReadError(false)
      setLegacy(false)
      if (intent && publisherChangeConfirmed(intent.policy, intent.change, fresh)) {
        intent = null
        setMessage(null)
      }
    } catch (error) {
      if (!alive || current !== generation) return
      setPolicy(null)
      setLegacy(isApiError(error) && error.status === 404)
      setReadError(true)
    } finally {
      if (alive && current === generation) setReading(false)
    }
  }

  createEffect(() => props.observedRevision, () => { void load() })

  const confirm = async () => {
    const selected = review()
    if (!selected || posting || !props.onBegin()) return
    posting = true
    setBusy(true)
    setReview(null)
    generation += 1
    intent = selected
    let failure = uiText("plugin_publishers_unconfirmed")
    try {
      await publisherPolicyService.change(selected.policy, selected.change)
    } catch (error) {
      if (isApiError(error) && error.status === 409) failure = uiText("plugin_publishers_changed")
    } finally {
      if (alive) setMessage(failure)
      await load()
      await props.onEnd()
      posting = false
      if (alive) setBusy(false)
    }
  }

  const blocked = () => props.disabled || busy() || reading()
  const modeLabel = () => policy()?.publisher_mode === "follow_defaults" ? uiText("plugin_publishers_follow") : uiText("plugin_publishers_explicit")
  const select = (change: PublisherPolicyChange) => {
    const current = policy()
    if (current && !blocked()) setReview({ policy: current, change })
  }
  const reviewedPublishers = createMemo(() => {
    const selected = review()
    if (!selected) return []
    const { change, policy } = selected
    if (change.type === "set_mode") return policy.publishers
    return policy.publishers.filter(({ id }) => id === change.publisher_id)
  })
  const reviewDescription = () => {
    const change = review()?.change
    return uiText(change?.type === "set_mode" ? change.publisher_mode === "follow_defaults" ?
      "plugin_publishers_review_defaults" : "plugin_publishers_review_explicit" : change?.type === "revoke" ?
      "plugin_publishers_review_revoke" : "plugin_publishers_review_trust")
  }

  return <Show when={!legacy() || policy()}><section class="rounded-lg border p-3 text-sm" aria-label={uiText("plugin_publishers_title")}>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <Button size="sm" variant="ghost" aria-expanded={expanded() ? "true" : "false"} onClick={() => { const opening = !expanded(); setExpanded(opening); if (opening) void load() }} disabled={busy()}>
        {uiText("plugin_publishers_title")}
      </Button>
      {policy() && <Badge variant="secondary">{modeLabel()}</Badge>}
    </div>
    {expanded() && <div class="mt-3 space-y-3">
      <p class="text-xs text-muted-foreground">{uiText("plugin_publishers_description")}</p>
      {policy()?.enforcement === "off" && <p class="text-xs text-destructive">{uiText("plugin_publishers_off")}</p>}
      {readError() && <p role="alert">{uiText("plugin_publishers_read_failed")}</p>}
      {message() && <p role="alert">{message()}</p>}
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={blocked()}>{uiText("plugin_publishers_refresh")}</Button>
        <Show when={policy()}>{(current) => <Button size="sm" variant="outline" disabled={blocked()} onClick={() => select({ type: "set_mode", publisher_mode: current().publisher_mode === "follow_defaults" ? "explicit" : "follow_defaults" })}>
          {current().publisher_mode === "follow_defaults" ? uiText("plugin_publishers_use_explicit") : uiText("plugin_publishers_use_defaults")}
        </Button>}</Show>
      </div>
      <Show when={policy()}>{(current) => <>
        <p class="text-xs text-muted-foreground">{uiText("plugin_publishers_custom_count", { count: current().custom_key_count })}</p>
        <ul class="space-y-3"><For each={current().publishers} keyed={(publisher) => publisher.id}>{(publisher) => <li class="space-y-1 rounded-md border p-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-medium">{publisher().key.label}</span>
            <Badge variant={publisher().revoked ? "warning" : "secondary"}>{publisher().revoked ? uiText("plugin_publishers_revoked") : publisher().trusted ? uiText("plugin_publishers_trusted") : uiText("plugin_publishers_untrusted")}</Badge>
          </div>
          <p class="break-all font-mono text-xs text-muted-foreground">{publisher().key.public_key}</p>
          <div class="flex flex-wrap gap-2">
            {!publisher().revoked && <Button size="sm" variant="outline" disabled={blocked()} onClick={() => select({ type: "revoke", publisher_id: publisher().id })} aria-label={uiText("plugin_publishers_revoke_named", { name: publisher().id })}>{uiText("plugin_publishers_revoke")}</Button>}
            {!publisher().trusted && <Button size="sm" variant="outline" disabled={blocked()} onClick={() => select({ type: "trust", publisher_id: publisher().id })} aria-label={uiText("plugin_publishers_trust_named", { name: publisher().id })}>{uiText("plugin_publishers_trust")}</Button>}
          </div>
        </li>}</For></ul>
      </>}</Show>
    </div>}
    <ResponsiveDialog open={review() !== null} onOpenChange={(open) => { if (!open) setReview(null) }}>
      <ResponsiveDialogContent class="gap-4 p-5 sm:max-w-xl">
        <ResponsiveDialogTitle>{uiText("plugin_publishers_review")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{reviewDescription()}</ResponsiveDialogDescription>
        <ul class="max-h-64 space-y-2 overflow-y-auto text-xs"><For each={reviewedPublishers()} keyed={(publisher) => publisher.id}>{(publisher) => <li>
          <p>{publisher().key.label}</p><p class="break-all font-mono">{publisher().key.public_key}</p>
        </li>}</For></ul>
        <div class="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setReview(null)}>{uiText("cancel_2cd0f3be")}</Button>
          <Button size="sm" disabled={blocked()} onClick={() => void confirm()}>{uiText("plugin_publishers_confirm")}</Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  </section></Show>
}
