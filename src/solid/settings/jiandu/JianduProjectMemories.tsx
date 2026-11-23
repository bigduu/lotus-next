import { createMemo, For, Show } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import {
  JIANDU_MEMORY_GRANULARITIES, JIANDU_MEMORY_LIMITS, JIANDU_MEMORY_TYPES, jianduMemoryApi,
  type JianduMemoryApiClient, type JianduMemoryListItem, type JianduMemoryType,
} from "@/services/memory/jianduMemoryApi"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../../ui/responsive-dialog"
import { Select } from "../../ui/select"
import { Textarea } from "../../ui/textarea"
import { createProjectMemories } from "./createProjectMemories"
import { createJianduText } from "./text"

type Controller = ReturnType<typeof createProjectMemories>
type Text = ReturnType<typeof createJianduText>["t"]
const errorClass = "rounded-lg border border-destructive/40 p-3 text-sm text-destructive"

function Header(props: { t: Text; enabled: boolean; onCreate?: () => void }) {
  return <header class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h2 class="text-lg font-semibold">{props.t("title")}</h2>
      <p class="text-sm text-muted-foreground">{props.t("description")}</p>
    </div>
    <Button type="button" disabled={!props.enabled} onClick={() => props.onCreate?.()}>{props.t("create.open")}</Button>
  </header>
}

function MemoryBadges(props: { item: JianduMemoryListItem; t: Text; showGranularity?: boolean }) {
  return <div class="flex flex-wrap gap-1.5">
    <Badge variant="outline">{props.t("types." + props.item.type)}</Badge>
    <Badge variant={props.item.status === "archived" ? "secondary" : "outline"}>{props.t("statuses." + props.item.status)}</Badge>
    <Show when={props.showGranularity && props.item.granularity}><Badge variant="outline">{props.item.granularity}</Badge></Show>
  </div>
}

function DetailDialogs(props: { state: Controller; t: Text }) {
  const state = props.state
  const t = props.t
  return <>
    <ResponsiveDialog open={!!(state.detail() || state.detailLoading() || state.detailError()) && !state.archiveTarget()}
      onOpenChange={(open) => { if (!open) state.closeDetail() }}>
      <ResponsiveDialogContent showCloseButton={false} class="gap-4 p-5 sm:max-w-2xl">
        <ResponsiveDialogTitle>{state.detail()?.title ?? t("detail.title")}</ResponsiveDialogTitle>
        <Show when={state.detailLoading()}><p role="status">{t("detail.loading")}</p></Show>
        <Show when={state.detailError()}><p role="alert" class="text-sm text-destructive">{t("errors." + state.detailError())}</p></Show>
        <Show when={state.detail()}>{(item) => <>
          <div class="min-h-0 space-y-3 overflow-y-auto">
            <MemoryBadges item={item()} t={t} />
            <Show when={item().bodyTruncated || item().retrievalMetadataTruncated}>
              <p role="status" class="text-xs text-amber-600 dark:text-amber-400">
                {t(item().bodyTruncated ? "detail.bodyTruncated" : "detail.metadataTruncated")}
              </p>
            </Show>
            <pre class="max-h-[50dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-sans text-sm">{item().body}</pre>
          </div>
        </>}</Show>
        <div class="flex justify-end gap-2">
          <Show when={state.detail() && state.detail()?.status !== "archived"}>
            <Button type="button" variant="destructive" onClick={state.openArchive}>{t("archive.open")}</Button>
          </Show>
          <Button type="button" variant="outline" onClick={state.closeDetail}>{t("detail.close")}</Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
    <ResponsiveDialog open={!!state.archiveTarget()} onOpenChange={(open) => { if (!open) state.closeArchive() }}>
      <ResponsiveDialogContent showCloseButton={false} dismissable={state.mutation() !== "archive"} class="gap-4 p-5">
        <ResponsiveDialogTitle>{t("archive.title", { title: state.archiveTarget()?.title ?? "" })}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{t("archive.description")}</ResponsiveDialogDescription>
        <Show when={state.archiveError()}><p role="alert" class="text-sm text-destructive">{t("errors." + state.archiveError())}</p></Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={!!state.mutation()} onClick={state.closeArchive}>{t("archive.cancel")}</Button>
          <Button type="button" variant="destructive" disabled={!!state.mutation()} onClick={() => void state.archiveMemory()}>
            {t(state.mutation() === "archive" ? "archive.archiving" : "archive.confirm")}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  </>
}

function CreateDialog(props: { state: Controller; t: Text }) {
  const state = props.state
  const t = props.t
  const busy = () => !!state.mutation()
  const types = () => JIANDU_MEMORY_TYPES.map((value) => ({ value, label: t("types." + value) }))
  const granularities = () => [
    { value: "none", label: t("create.noGranularity") },
    ...JIANDU_MEMORY_GRANULARITIES.map((value) => ({ value, label: value })),
  ]

  return <ResponsiveDialog open={state.creating()} onOpenChange={(open) => { if (!open) state.closeCreate() }}>
    <ResponsiveDialogContent showCloseButton={false} dismissable={!busy()} class="gap-4 p-5 sm:max-w-2xl">
      <ResponsiveDialogTitle>{t("create.title")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>{t("create.description")}</ResponsiveDialogDescription>
      <div class="min-h-0 space-y-3 overflow-y-auto pr-1">
        <div class="space-y-1.5">
          <Label for="jiandu-title">{t("create.titleLabel")}</Label>
          <Input id="jiandu-title" value={state.draft().title} maxlength={JIANDU_MEMORY_LIMITS.titleChars} disabled={busy()}
            onInput={(event) => state.updateDraft("title", event.currentTarget.value)} />
        </div>
        <div class="space-y-1.5">
          <Label>{t("create.typeLabel")}</Label>
          <Select selectOnly label={t("create.typeLabel")} class="w-full" options={types()} value={state.draft().type} disabled={busy()}
            onValueChange={(value) => state.updateDraft("type", value as JianduMemoryType)} />
        </div>
        <div class="space-y-1.5">
          <Label for="jiandu-body">{t("create.bodyLabel")}</Label>
          <Textarea id="jiandu-body" rows={7} maxlength={JIANDU_MEMORY_LIMITS.bodyChars} disabled={busy()}
            value={state.draft().content} onInput={(event) => state.updateDraft("content", event.currentTarget.value)} />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <For each={["tags", "keywords", "entities"] as const}>{(field) =>
            <div class="space-y-1.5">
              <Label for={"jiandu-" + field}>{t("create." + field + "Label")}</Label>
              <Input id={"jiandu-" + field} value={state.draft()[field]} disabled={busy()} placeholder={t("create.csvHint")}
                onInput={(event) => state.updateDraft(field, event.currentTarget.value)} />
            </div>
          }</For>
          <div class="space-y-1.5">
            <Label>{t("create.granularityLabel")}</Label>
            <Select selectOnly label={t("create.granularityLabel")} class="w-full" options={granularities()} disabled={busy()}
              value={state.draft().granularity || "none"} onValueChange={(value) => state.updateDraft("granularity", value === "none" ? "" : value)} />
          </div>
        </div>
        <Show when={state.createError()}><p role="alert" class="text-sm text-destructive">{t("errors." + state.createError())}</p></Show>
        <Show when={state.preflight()}>{(preview) =>
          <section class="rounded-lg border p-3" aria-label={t("create.matchesLabel")}>
            <h3 class="text-sm font-medium">{t(preview().matches.items.length ? "create.matches" : "create.noMatches")}</h3>
            <Show when={preview().matches.items.length}>
              <ul class="mt-2 space-y-1 text-sm">
                <For each={preview().matches.items}>{(item) => <li>{item.title} · {t("statuses." + item.status)}</li>}</For>
              </ul>
            </Show>
            <Show when={preview().matches.truncated}><p class="mt-2 text-xs text-muted-foreground">{t("create.matchesTruncated")}</p></Show>
          </section>
        }</Show>
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy()} onClick={state.closeCreate}>{t("create.close")}</Button>
        <Button type="button" variant="secondary" disabled={state.preflightLoading() || busy()} onClick={() => void state.runPreflight()}>
          {t(state.preflightLoading() ? "create.lookingUp" : "create.lookup")}
        </Button>
        <Button type="button" disabled={!state.canConfirmCreate()} onClick={() => void state.createMemory()}>
          {t(busy() ? "create.creating" : "create.confirm")}
        </Button>
      </div>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}

function ProjectMemories(props: { sessionId: string; api: JianduMemoryApiClient }) {
  const { t } = createJianduText()
  const view = createProjectMemories(props.sessionId, props.api)
  const listBusy = () => view.listLoading() || !!view.mutation()
  const statuses = () => (["active", "archived"] as const).map((value) => ({ value, label: t("statuses." + value) }))

  return <>
    <Header t={t} enabled={!!view.context() && !view.contextLoading()} onCreate={view.openCreate} />
    <section class="rounded-lg border p-3" aria-label={t("context.label")}>
      <div class="text-xs font-medium text-muted-foreground">{t("context.label")}</div>
      <Show when={!view.contextLoading()} fallback={<p role="status" class="mt-1 text-sm">{t("context.loading")}</p>}>
        <Show when={view.context()} fallback={
          <div class="mt-2 space-y-2">
            <p role="alert" class="text-sm text-destructive">{t("errors." + (view.contextError() ?? "context"))}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void view.loadContext()}>{t("context.retry")}</Button>
          </div>
        }>{(scope) =>
          <dl class="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt class="text-xs text-muted-foreground">{t("context.session")}</dt><dd class="break-words font-medium">{scope().activeSessionTitle}</dd></div>
            <div><dt class="text-xs text-muted-foreground">{t("context.project")}</dt><dd class="break-all font-mono text-xs">{scope().projectId}</dd></div>
            <Show when={scope().activeSessionId !== scope().authoritySessionId}>
              <div class="sm:col-span-2"><dt class="text-xs text-muted-foreground">{t("context.rootSession")}</dt><dd>{scope().authoritySessionTitle}</dd></div>
            </Show>
          </dl>
        }</Show>
      </Show>
    </section>
    <Show when={view.notice()}>{(notice) =>
      <p role="status" class="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">{t("notices." + notice().kind, { title: notice().title })}</p>
    }</Show>
    <Show when={view.context()}>
      <form class="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); view.search() }}>
        <Input aria-label={t("search.label")} value={view.query()} maxlength={JIANDU_MEMORY_LIMITS.queryChars}
          onInput={(event) => view.setQuery(event.currentTarget.value)} placeholder={t("search.placeholder")} />
        <Select selectOnly label={t("search.statusLabel")} class="w-full sm:w-36" value={view.filter()} disabled={listBusy()} options={statuses()}
          onValueChange={(value) => view.setFilter(value as "active" | "archived")} />
        <Button type="submit" disabled={listBusy()}>{t("search.action")}</Button>
        <Button type="button" variant="outline" disabled={listBusy()} onClick={() => view.refresh()}>{t("search.refresh")}</Button>
      </form>
      <Show when={view.listError()}><p role="alert" class={errorClass}>{t("errors." + view.listError())}</p></Show>
      <Show when={view.page()}>{(page) =>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{t("list.count", { visible: view.items().length, matched: page().matchedCount })}</span>
          <Show when={page().truncated}><span>{t("list.truncated")}</span></Show>
          <Show when={page().remainingCount > 0}><span>{t("list.remaining", { count: page().remainingCount })}</span></Show>
        </div>
      }</Show>
      <Show when={view.items().length > 0} fallback={
        <Show when={view.page() && !view.listLoading()}><p class="rounded-lg border p-4 text-sm text-muted-foreground">{t("list.empty")}</p></Show>
      }>
        <ul class="space-y-2" aria-label={t("list.label")}>
          <For each={view.items()} keyed={(item) => item.id}>{(item) =>
            <li class="space-y-2 rounded-lg border p-3">
              <button type="button" class="max-w-full break-words text-left text-sm font-semibold hover:underline"
                disabled={view.detailLoading() === item().id} onClick={() => void view.openDetail(item())}>{item().title}</button>
              <MemoryBadges item={item()} t={t} showGranularity />
              <p class="whitespace-pre-wrap break-words text-sm text-muted-foreground">{item().summary}</p>
            </li>
          }</For>
        </ul>
      </Show>
      <Show when={view.listLoading()}><p role="status">{t("list.loading")}</p></Show>
      <Show when={view.page()?.nextCursor}>
        <Button type="button" variant="outline" class="w-full" disabled={listBusy()} onClick={() => view.refresh(true)}>{t("list.more")}</Button>
      </Show>
    </Show>
    <DetailDialogs state={view} t={t} />
    <CreateDialog state={view} t={t} />
  </>
}

export function JianduProjectMemories(props: { api?: JianduMemoryApiClient }) {
  const { t } = createJianduText()
  const activeSession = createStoreSelector(appStore, (state) => state.currentSessionId)
  const scope = createMemo(() => {
    const sessionId = activeSession()
    return sessionId ? { sessionId, api: props.api ?? jianduMemoryApi } : null
  })

  return <div class="space-y-4" data-jiandu-project-memories="">
    <Show when={scope()} keyed fallback={
      <>
        <Header t={t} enabled={false} />
        <section class="rounded-lg border p-3" aria-label={t("context.label")}>
          <div class="text-xs font-medium text-muted-foreground">{t("context.label")}</div>
          <p role="alert" class="mt-2 text-sm text-destructive">{t("errors.context")}</p>
        </section>
      </>
    }>{(selected) => <ProjectMemories sessionId={selected.sessionId} api={selected.api} />}</Show>
  </div>
}
