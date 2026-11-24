import { AlertCircle, Loader2, Monitor, Pencil, Plus, RefreshCw, Server, Trash2, X } from "@lucide/solid"
import { For, Show } from "solid-js"
import type { FabricCluster, FabricNode, NodeStatus } from "@services/config/SettingsService"
import { uiList } from "@shared/i18n/text"
import { cn } from "@/lib/utils"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"
import { ClusterDialog, NodeDialog, NodeLogsDialog, placementLabel } from "./ClusterDialogs"
import { ACTION_LABEL, createClusterFabric, type ClusterFabric } from "./createClusterFabric"

const STATUS: Record<NodeStatus, { label: Parameters<ClusterFabric["text"]>[0]; class: string }> = {
  not_deployed: { label: "not_deployed_d5c4befa", class: "bg-muted text-muted-foreground" },
  deploying: { label: "deploying_096fbd86", class: "animate-pulse bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  running: { label: "running_1f0eb99b", class: "bg-primary/15 text-primary" },
  unreachable: { label: "unreachable_8d7c0301", class: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  stopped: { label: "stopped_f006455e", class: "bg-muted text-muted-foreground" },
  failed: { label: "failed_28384d7a", class: "bg-destructive/15 text-destructive" },
}

const ACTIONS = ["test", "deploy", "stop"] as const

function lastSeen(iso: string | undefined, text: ClusterFabric["text"]) {
  const at = iso ? new Date(iso).getTime() : NaN
  if (Number.isNaN(at)) return ""
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (seconds < 60) return text("seconds_ago_f58a9f01", { v0: seconds, count: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return text("minutes_ago_700ed992", { v0: minutes, count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return text("hours_ago_c8f8001b", { v0: hours, count: hours })
  const days = Math.floor(hours / 24)
  return text("days_ago_f0351b9d", { v0: days, count: days })
}

function EditDeleteControls(props: { fabric: ClusterFabric; id: string; kind: "node" | "cluster"; edit: () => void }) {
  const { text, deleteTarget, operation } = props.fabric
  const confirmed = () => deleteTarget()?.kind === props.kind && deleteTarget()?.id === props.id
  return <div class="ml-auto flex shrink-0 items-center gap-1">
    <Show when={confirmed()} fallback={<>
      <button type="button" disabled={!!operation()} onClick={props.edit}
        aria-label={text(props.kind === "node" ? "edit_node_eca9fae8" : "edit_cluster_28890c2b")}
        class="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
        <Pencil class="size-3.5" />
      </button>
      <button type="button" disabled={!!operation()} onClick={() => props.fabric.requestDelete(props.kind, props.id)}
        aria-label={text(props.kind === "node" ? "delete_node_685e2d0b" : "delete_cluster_7ab3ed6c")}
        class="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50">
        <Trash2 class="size-3.5" />
      </button>
    </>}>
      <span class="text-xs text-destructive">{text("confirm_deletion_2d61cf17")}</span>
      <Button type="button" size="sm" variant="destructive" class="h-7 px-2 text-xs" disabled={!!operation()}
        onClick={() => void props.fabric.confirmDelete(props.kind, props.id)}>{text("delete_2f9daa82")}</Button>
      <Button type="button" size="sm" variant="secondary" class="h-7 px-2 text-xs" disabled={!!operation()}
        onClick={props.fabric.cancelDelete}>{text("cancel_2cd0f3be")}</Button>
    </Show>
  </div>
}

function NodeRow(props: { fabric: ClusterFabric; node: FabricNode }) {
  const c = props.fabric
  const text = c.text
  const status = () => props.node.state?.status ?? "not_deployed"
  const meta = () => STATUS[status()] ?? STATUS.not_deployed
  const failure = () => status() === "unreachable" || status() === "failed" ? props.node.state?.last_error : undefined
  const seen = () => lastSeen(props.node.state?.last_health, text)
  const actionInFlight = (action: typeof ACTIONS[number]) => {
    const active = c.operation()
    return active?.kind === "action" && active.id === props.node.id && active.action === action
  }
  return <li class="space-y-1.5 rounded-lg border p-3">
    <div class="flex items-center gap-2">
      <Show when={props.node.placement.type === "ssh"} fallback={<Monitor class="size-3.5 shrink-0 text-muted-foreground" />}>
        <Server class="size-3.5 shrink-0 text-muted-foreground" />
      </Show>
      <span class="min-w-0 flex-1 truncate text-sm font-medium">{props.node.label}</span>
      <Badge variant="outline" class={cn("border-transparent", meta().class)} title={failure()}>{text(meta().label)}</Badge>
      <Switch checked={props.node.enabled} disabled={!!c.operation()}
        aria-label={text(props.node.enabled ? "disable_node_8a809f1d" : "enable_node_b7e7cd5a")}
        onCheckedChange={(enabled) => void c.toggleNode(props.node, enabled)} />
    </div>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span class="font-mono [overflow-wrap:anywhere]">{placementLabel(props.node, text)}</span>
      <Show when={c.nodeClusters().get(props.node.id)}>
        <Badge variant="outline" class="h-4 px-1.5 text-[10px]">{c.nodeClusters().get(props.node.id)}</Badge>
      </Show>
      <Show when={props.node.trust_level === "untrusted"}>
        <Badge variant="warning" class="h-4 px-1.5 text-[10px]">{text("untrusted_1ddc3b8a")}</Badge>
      </Show>
      <Show when={!props.node.enabled}><span>{text("disabled_a8c3698b")}</span></Show>
      <Show when={seen()}><span>{text("last_active_30f38ff1")} {seen()}</span></Show>
    </div>
    <Show when={failure()}><p class="truncate text-xs text-destructive" title={failure()}>{failure()}</p></Show>
    <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
      <For each={ACTIONS}>{(action) =>
        <Button type="button" size="sm" variant="secondary" class="h-7 px-2 text-xs" disabled={!!c.operation()}
          onClick={() => void c.runAction(props.node, action)}>
          <Show when={actionInFlight(action)}><Loader2 class="size-3 animate-spin" /></Show>
          {text(ACTION_LABEL[action])}
        </Button>
      }</For>
      <Button type="button" size="sm" variant="secondary" class="h-7 px-2 text-xs" onClick={() => void c.readLogs(props.node)}>
        {text("logs_7dbac1c2")}
      </Button>
      <EditDeleteControls fabric={c} id={props.node.id} kind="node" edit={() => c.openNode(props.node)} />
    </div>
  </li>
}

function ClusterRow(props: { fabric: ClusterFabric; cluster: FabricCluster }) {
  const c = props.fabric
  const summary = () => {
    const cluster = props.cluster
    const count = c.text("count_nodes", { count: cluster.node_ids.length })
    const names = uiList(cluster.node_ids.map((id) => c.nodes().find((node) => node.id === id)?.label ?? id))
    return [count, names, cluster.description].filter(Boolean).join(" · ")
  }
  return <li class="flex items-center gap-2 rounded-lg border p-3">
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium">{props.cluster.name}</div>
      <div class="truncate text-xs text-muted-foreground">{summary()}</div>
    </div>
    <EditDeleteControls fabric={c} id={props.cluster.name} kind="cluster" edit={() => c.openCluster(props.cluster)} />
  </li>
}

export function SettingsClusters() {
  const c = createClusterFabric()
  const { text, notice, loadError, loading, nodes, clusters, operation } = c
  return <div class="space-y-3">
    <p class="text-xs text-muted-foreground">{text("register_local_or_remote_ssh_machines_to_deploy_worker__bf3f5b75")}</p>
    <Show when={notice()}>{(entry) =>
      <div role={entry().kind === "err" ? "alert" : "status"} class={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        entry().kind === "err" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10 text-primary")}>
        <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{entry().text}</span>
        <button type="button" onClick={c.dismissNotice} aria-label={text("dismiss_notification_d301bc12")}
          class="shrink-0 opacity-70 hover:opacity-100"><X class="size-3.5" /></button>
      </div>
    }</Show>
    <Show when={loadError()}>
      <div role="alert" class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertCircle class="size-3.5 shrink-0" />
        <span class="min-w-0 flex-1">{loadError()}</span>
        <Button type="button" size="sm" variant="secondary" class="h-7 px-2 text-xs"
          onClick={() => void c.refresh()}>{text("retry_b8784c8d")}</Button>
      </div>
    </Show>
    <section class="rounded-lg border p-3" aria-label={text("nodes_2410d860")}>
      <div class="mb-2 flex items-center justify-between">
        <div class="text-xs font-medium text-muted-foreground">{text("nodes_2410d860")}</div>
        <div class="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" class="h-7 px-2" aria-label={text("refresh_aee88743")}
            disabled={!!operation()} onClick={() => void c.refresh()}>
            <RefreshCw class={cn("size-3.5", loading() && "animate-spin")} />
          </Button>
          <Button type="button" size="sm" variant="secondary" class="h-7 px-2 text-xs" disabled={!!operation()}
            onClick={() => c.openNode()}><Plus class="size-3.5" />{text("add_node_09da9abd")}</Button>
        </div>
      </div>
      <Show when={nodes().length} fallback={<p class="text-xs text-muted-foreground">
        {text(loading() ? "loading_4927a53b" : "no_nodes_yet_281309d3")}
      </p>}>
        <ul class="space-y-2">
          <For each={nodes()} keyed={(node) => node.id}>{(node) => <NodeRow node={node()} fabric={c} />}</For>
        </ul>
      </Show>
    </section>
    <section class="rounded-lg border p-3" aria-label={text("clusters_5318ca46")}>
      <div class="mb-2 flex items-center justify-between">
        <div class="text-xs font-medium text-muted-foreground">{text("clusters_5318ca46")}</div>
        <Button type="button" size="sm" variant="secondary" class="h-7 px-2 text-xs" disabled={!!operation()}
          onClick={() => c.openCluster()}><Plus class="size-3.5" />{text("add_cluster_0a87eec0")}</Button>
      </div>
      <Show when={clusters().length} fallback={<p class="text-xs text-muted-foreground">{text("no_clusters_yet_25b2d086")}</p>}>
        <ul class="space-y-2">
          <For each={clusters()} keyed={(cluster) => cluster.name}>{(cluster) => <ClusterRow cluster={cluster()} fabric={c} />}</For>
        </ul>
      </Show>
    </section>
    <NodeDialog fabric={c} />
    <ClusterDialog fabric={c} />
    <NodeLogsDialog fabric={c} />
  </div>
}
