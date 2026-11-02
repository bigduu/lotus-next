import { useCallback, useEffect, useRef, useState } from "react"
import { publisherChangeConfirmed, publisherPolicyService, type PublisherPolicy, type PublisherPolicyChange } from "@services/plugin"
import { isApiError } from "@services/api"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"

interface Review { policy: PublisherPolicy; change: PublisherPolicyChange }
interface Props {
  disabled: boolean
  observedRevision?: number
  onBegin: () => boolean
  onEnd: () => Promise<unknown>
}

export function PublisherTrustPanel({ disabled, observedRevision, onBegin, onEnd }: Props) {
  useUiLocale()
  const [policy, setPolicy] = useState<PublisherPolicy | null>(null)
  const [legacy, setLegacy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [reading, setReading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const alive = useRef(true)
  const generation = useRef(0)
  const posting = useRef(false)
  const intent = useRef<Review | null>(null)

  const load = useCallback(async () => {
    const current = ++generation.current
    setReading(true)
    try {
      const fresh = await publisherPolicyService.get()
      if (!alive.current || current !== generation.current) return
      setPolicy(fresh)
      setReadError(false)
      setLegacy(false)
      if (intent.current && publisherChangeConfirmed(intent.current.policy, intent.current.change, fresh)) {
        intent.current = null
        setMessage(null)
      }
    } catch (error) {
      if (!alive.current || current !== generation.current) return
      setPolicy(null)
      setLegacy(isApiError(error) && error.status === 404)
      setReadError(true)
    } finally {
      if (alive.current && current === generation.current) setReading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; generation.current += 1 }
  }, [])
  useEffect(() => { void load() }, [load, observedRevision])

  const confirm = async () => {
    const selected = review
    if (!selected || posting.current || !onBegin()) return
    posting.current = true
    setBusy(true)
    setReview(null)
    generation.current += 1
    intent.current = selected
    let failure = uiText("plugin_publishers_unconfirmed")
    try {
      await publisherPolicyService.change(selected.policy, selected.change)
    } catch (error) {
      if (isApiError(error) && error.status === 409) failure = uiText("plugin_publishers_changed")
    } finally {
      if (alive.current) setMessage(failure)
      await load()
      await onEnd()
      posting.current = false
      if (alive.current) setBusy(false)
    }
  }

  if (legacy && !policy) return null
  const blocked = disabled || busy || reading
  const modeLabel = policy?.publisher_mode === "follow_defaults" ? uiText("plugin_publishers_follow") : uiText("plugin_publishers_explicit")
  const select = (change: PublisherPolicyChange) => {
    if (policy && !blocked) setReview({ policy, change })
  }
  const reviewedChange = review?.change
  const selectedPublisher = reviewedChange && reviewedChange.type !== "set_mode" ? review?.policy.publishers.find(({ id }) => id === reviewedChange.publisher_id) : undefined

  return <section className="rounded-lg border p-3 text-sm" aria-label={uiText("plugin_publishers_title")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (!expanded) void load() }} disabled={busy}>
        {uiText("plugin_publishers_title")}
      </Button>
      {policy && <Badge variant="secondary">{modeLabel}</Badge>}
    </div>
    {expanded && <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">{uiText("plugin_publishers_description")}</p>
      {policy?.enforcement === "off" && <p className="text-xs text-destructive">{uiText("plugin_publishers_off")}</p>}
      {readError && <p role="alert">{uiText("plugin_publishers_read_failed")}</p>}
      {message && <p role="alert">{message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={blocked}>{uiText("plugin_publishers_refresh")}</Button>
        {policy && <Button size="sm" variant="outline" disabled={blocked} onClick={() => select({ type: "set_mode", publisher_mode: policy.publisher_mode === "follow_defaults" ? "explicit" : "follow_defaults" })}>
          {policy.publisher_mode === "follow_defaults" ? uiText("plugin_publishers_use_explicit") : uiText("plugin_publishers_use_defaults")}
        </Button>}
      </div>
      {policy && <>
        <p className="text-xs text-muted-foreground">{uiText("plugin_publishers_custom_count", { count: policy.custom_key_count })}</p>
        <ul className="space-y-3">{policy.publishers.map((publisher) => <li key={publisher.id} className="space-y-1 rounded-md border p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{publisher.key.label}</span>
            <Badge variant={publisher.revoked ? "warning" : "secondary"}>{publisher.revoked ? uiText("plugin_publishers_revoked") : publisher.trusted ? uiText("plugin_publishers_trusted") : uiText("plugin_publishers_untrusted")}</Badge>
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground">{publisher.key.public_key}</p>
          <div className="flex flex-wrap gap-2">
            {!publisher.revoked && <Button size="sm" variant="outline" disabled={blocked} onClick={() => select({ type: "revoke", publisher_id: publisher.id })} aria-label={uiText("plugin_publishers_revoke_named", { name: publisher.id })}>{uiText("plugin_publishers_revoke")}</Button>}
            {!publisher.trusted && <Button size="sm" variant="outline" disabled={blocked} onClick={() => select({ type: "trust", publisher_id: publisher.id })} aria-label={uiText("plugin_publishers_trust_named", { name: publisher.id })}>{uiText("plugin_publishers_trust")}</Button>}
          </div>
        </li>)}</ul>
      </>}
    </div>}
    <ResponsiveDialog open={review !== null} onOpenChange={(open) => { if (!open) setReview(null) }}>
      <ResponsiveDialogContent className="gap-4 p-5 sm:max-w-xl">
        <ResponsiveDialogTitle>{uiText("plugin_publishers_review")}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{review?.change.type === "set_mode" ? review.change.publisher_mode === "follow_defaults" ? uiText("plugin_publishers_review_defaults") : uiText("plugin_publishers_review_explicit") : review?.change.type === "revoke" ? uiText("plugin_publishers_review_revoke") : uiText("plugin_publishers_review_trust")}</ResponsiveDialogDescription>
        <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">{(selectedPublisher ? [selectedPublisher] : review?.policy.publishers ?? []).map(({ id, key }) => <li key={id}>
          <p>{key.label}</p><p className="break-all font-mono">{key.public_key}</p>
        </li>)}</ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setReview(null)}>{uiText("cancel_2cd0f3be")}</Button>
          <Button size="sm" disabled={blocked} onClick={() => void confirm()}>{uiText("plugin_publishers_confirm")}</Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  </section>
}
