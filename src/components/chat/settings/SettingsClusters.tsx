import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  Check,
  Loader2,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-react"
import {
  settingsService,
  type FabricCluster,
  type FabricNode,
  type NodePlacement,
  type NodeStatus,
  type NodeUpsertRequest,
  type SshAuth,
  type TrustLevel,
} from "@services/config/SettingsService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"

// Backend redacts SSH secrets to this sentinel; re-sending it on update
// preserves the stored ciphertext (see bamboo cluster_fabric handlers).
const SECRET_MASK = "****...****"

const STATUS_POLL_MS = 30_000

const STATUS_META: Record<NodeStatus, { label: string; cls: string }> = {
  not_deployed: { get label() { return uiText("not_deployed_d5c4befa") }, cls: "bg-muted text-muted-foreground" },
  deploying: {
    get label() { return uiText("deploying_096fbd86") },
    cls: "animate-pulse bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  running: { get label() { return uiText("running_1f0eb99b") }, cls: "bg-primary/15 text-primary" },
  unreachable: {
    get label() { return uiText("unreachable_8d7c0301") },
    cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  stopped: { get label() { return uiText("stopped_f006455e") }, cls: "bg-muted text-muted-foreground" },
  failed: { get label() { return uiText("failed_28384d7a") }, cls: "bg-destructive/15 text-destructive" },
}

type NodeAction = "test" | "deploy" | "stop"

const ACTION_LABEL: Record<NodeAction, string> = {
  get test() { return uiText("test_6aa8f49c") },
  get deploy() { return uiText("deploy_3ca77185") },
  get stop() { return uiText("stop_ca4d973c") },
}

const ACTION_OK: Record<NodeAction, string> = {
  get test() { return uiText("connected_successfully_4a19cb8a") },
  get deploy() { return uiText("deployment_triggered_7e32b41b") },
  get stop() { return uiText("stop_triggered_72121661") },
}

/** Coarse "N 前" from an RFC3339 timestamp (recomputed each render / poll). */
function sinceLabel(iso?: string): string {
  if (!iso) return ""
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return uiText("seconds_ago_f58a9f01", { v0: secs , count: secs })
  const mins = Math.floor(secs / 60)
  if (mins < 60) return uiText("minutes_ago_700ed992", { v0: mins , count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return uiText("hours_ago_c8f8001b", { v0: hrs , count: hrs })
  return uiText("days_ago_f0351b9d", { v0: Math.floor(hrs / 24) , count: Math.floor(hrs / 24) })
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function placementText(node: FabricNode): string {
  return node.placement.type === "ssh"
    ? `${node.placement.username}@${node.placement.host}:${node.placement.port}`
    : uiText("local_8a94c4a1")
}

interface NodeForm {
  label: string
  placementType: "local" | "ssh"
  host: string
  port: string
  username: string
  authMethod: "password" | "private_key" | "system_ssh_config"
  password: string
  privateKey: string
  privateKeyPath: string
  passphrase: string
  trustLevel: TrustLevel
  artifactPath: string
  remoteDir: string
  defaultRole: string
  model: string
  workspace: string
  autoRecover: boolean
  enabled: boolean
}

const EMPTY_FORM: NodeForm = {
  label: "",
  placementType: "ssh",
  host: "",
  port: "22",
  username: "",
  authMethod: "password",
  password: "",
  privateKey: "",
  privateKeyPath: "",
  passphrase: "",
  trustLevel: "trusted",
  artifactPath: "",
  remoteDir: "",
  defaultRole: "",
  model: "",
  workspace: "",
  autoRecover: false,
  enabled: true,
}

/**
 * Remote Cluster Fabric management: register nodes (local or SSH machines) to
 * deploy worker agents onto, grouped into clusters. SSH credentials are
 * encrypted at rest by the backend and never returned in plaintext — the API
 * hands back a mask sentinel that, when re-sent, preserves the stored secret.
 */
export function SettingsClusters() {
  useUiLocale()
  const [nodes, setNodes] = useState<FabricNode[]>([])
  const [clusters, setClusters] = useState<FabricCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Transient action feedback (success auto-dismisses; errors stay).
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const notify = useCallback((kind: "ok" | "err", text: string) => {
    setNotice({ kind, text })
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    if (kind === "ok") {
      noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
    }
  }, [])
  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    },
    [],
  )

  // Node editor dialog
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<NodeForm>(EMPTY_FORM)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Logs dialog
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsNode, setLogsNode] = useState<FabricNode | null>(null)
  const [logsText, setLogsText] = useState("")
  const [logsLoading, setLogsLoading] = useState(false)

  // Cluster editor dialog
  const [clusterOpen, setClusterOpen] = useState(false)
  const [clusterEditingName, setClusterEditingName] = useState<string | null>(null)
  const [clusterName, setClusterName] = useState("")
  const [clusterDesc, setClusterDesc] = useState("")
  const [clusterNodeIds, setClusterNodeIds] = useState<string[]>([])
  const [clusterError, setClusterError] = useState<string | null>(null)
  const [clusterSaving, setClusterSaving] = useState(false)

  // Row-level busy / confirm state
  const [pending, setPending] = useState<{ id: string; action: NodeAction } | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteCluster, setConfirmDeleteCluster] = useState<string | null>(null)

  // ── Data ─────────────────────────────────────────────────────────

  // Monotonic id so an out-of-order fetch (a slow poll resolving after a newer
  // load/poll) can't overwrite fresher data.
  const fetchSeq = useRef(0)

  const fetchAll = useCallback(async (silent = false) => {
    const seq = ++fetchSeq.current
    if (!silent) setLoading(true)
    try {
      const res = await settingsService.listNodes()
      if (seq !== fetchSeq.current) return // superseded by a newer fetch
      setNodes(res.nodes ?? [])
      setClusters(res.clusters ?? [])
      setLoadError(null)
    } catch (e) {
      // A background poll shouldn't spam errors; only surface explicit loads.
      if (seq === fetchSeq.current && !silent) {
        setLoadError(errMsg(e, uiText("could_not_load_cluster_settings_96bba618")))
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  // Live health: silently re-poll while the panel is visible and no dialog is
  // open, so status flips (running↔unreachable) + "last seen" refresh without
  // a manual reload. Also refreshes immediately on regaining visibility.
  // (#34 regression lesson: fetch-on-mount-only left stale health on screen.)
  const anyDialogOpen = editorOpen || logsOpen || clusterOpen
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && !anyDialogOpen) {
        void fetchAll(true)
      }
    }
    const timer = window.setInterval(tick, STATUS_POLL_MS)
    document.addEventListener("visibilitychange", tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [fetchAll, anyDialogOpen])

  // Map node id → its cluster name (first membership wins) for row badges.
  const nodeClusterName = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of clusters) {
      for (const id of c.node_ids) {
        if (!map.has(id)) map.set(id, c.name)
      }
    }
    return map
  }, [clusters])

  // ── Node editor ──────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setEditorError(null)
    setEditorOpen(true)
  }

  const openEdit = (node: FabricNode) => {
    const ssh = node.placement.type === "ssh" ? node.placement : undefined
    const auth = ssh?.auth
    setEditingId(node.id)
    setForm({
      label: node.label,
      placementType: node.placement.type,
      host: ssh?.host ?? "",
      port: String(ssh?.port ?? 22),
      username: ssh?.username ?? "",
      authMethod: auth?.method ?? "password",
      // Secrets come back masked; leave blank so the user re-enters only to change.
      password: "",
      privateKey: "",
      privateKeyPath: auth?.method === "private_key" ? (auth.private_key_path ?? "") : "",
      passphrase: "",
      trustLevel: node.trust_level ?? "trusted",
      artifactPath: node.deploy?.artifact_path ?? "",
      remoteDir: node.deploy?.remote_dir ?? "",
      defaultRole: node.deploy?.default_role ?? "",
      model: node.deploy?.model ?? "",
      workspace: node.deploy?.workspace ?? "",
      autoRecover: node.deploy?.auto_recover ?? false,
      enabled: node.enabled,
    })
    setEditorError(null)
    setEditorOpen(true)
  }

  const closeEditor = () => {
    setEditorOpen(false)
    setEditingId(null)
    setEditorError(null)
  }

  const setField = <K extends keyof NodeForm>(key: K, value: NodeForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const editingNode = editingId ? nodes.find((n) => n.id === editingId) : undefined
  const editingOriginalAuth =
    editingNode?.placement.type === "ssh" ? editingNode.placement.auth : undefined

  const validateForm = (f: NodeForm): string | null => {
    if (!f.label.trim()) return uiText("name_is_required_e8365416")
    if (f.placementType === "ssh") {
      if (!f.host.trim()) return uiText("host_is_required_0c6a959b")
      if (!f.username.trim()) return uiText("username_is_required_390ccdec")
      const port = Number(f.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) return uiText("port_must_be_between_1_and_65535_2cc08f2a")
      if (f.authMethod === "password") {
        const hasExisting =
          editingOriginalAuth?.method === "password" && Boolean(editingOriginalAuth.password)
        if (!f.password && !hasExisting) return uiText("password_is_required_3aa7a9e0")
      }
      if (f.authMethod === "private_key") {
        const hasEntered = Boolean(f.privateKey.trim() || f.privateKeyPath.trim())
        const hasExisting =
          editingOriginalAuth?.method === "private_key" &&
          Boolean(editingOriginalAuth.private_key || editingOriginalAuth.private_key_path)
        if (!hasEntered && !hasExisting) return uiText("provide_private_key_content_or_a_private_key_file_path_e183c9eb")
      }
    }
    return null
  }

  const buildPlacement = (f: NodeForm): NodePlacement => {
    if (f.placementType === "local") return { type: "local" }
    // Only mask-preserve a secret the edited node ACTUALLY had on the SAME auth
    // method, so switching auth methods (password→key) or clearing an inline
    // key never stores the mask string as a bogus secret.
    const originalAuth = editingOriginalAuth
    const preserve = (existing: string | undefined, entered: string) =>
      Boolean(existing) && !entered
    let auth: SshAuth
    if (f.authMethod === "system_ssh_config") {
      auth = { method: "system_ssh_config" }
    } else if (f.authMethod === "private_key") {
      const existingKey =
        originalAuth?.method === "private_key" ? originalAuth.private_key : undefined
      const existingPass =
        originalAuth?.method === "private_key" ? originalAuth.passphrase : undefined
      auth = {
        method: "private_key",
        private_key: preserve(existingKey, f.privateKey)
          ? SECRET_MASK
          : f.privateKey || undefined,
        private_key_path: f.privateKeyPath.trim() || undefined,
        passphrase: preserve(existingPass, f.passphrase)
          ? SECRET_MASK
          : f.passphrase || undefined,
      }
    } else {
      const existingPw =
        originalAuth?.method === "password" ? originalAuth.password : undefined
      auth = {
        method: "password",
        password: preserve(existingPw, f.password) ? SECRET_MASK : f.password,
      }
    }
    return {
      type: "ssh",
      host: f.host.trim(),
      port: Number(f.port) || 22,
      username: f.username.trim(),
      auth,
    }
  }

  const saveNode = async () => {
    const invalid = validateForm(form)
    if (invalid) {
      setEditorError(invalid)
      return
    }
    const req: NodeUpsertRequest = {
      label: form.label.trim(),
      placement: buildPlacement(form),
      trust_level: form.trustLevel,
      enabled: form.enabled,
      deploy: {
        artifact_path: form.artifactPath.trim() || undefined,
        // Server replaces the deploy profile wholesale; carry the checksum forward.
        artifact_sha256: editingNode?.deploy?.artifact_sha256,
        remote_dir: form.remoteDir.trim() || undefined,
        default_role: form.defaultRole.trim() || undefined,
        model: form.model.trim() || undefined,
        workspace: form.workspace.trim() || undefined,
        auto_recover: form.autoRecover,
      },
    }
    setSaving(true)
    setEditorError(null)
    try {
      if (editingId) await settingsService.updateNode(editingId, req)
      else await settingsService.createNode(req)
      notify("ok", editingId ? uiText("node_updated_726bbf53") : uiText("node_created_a2d136da"))
      closeEditor()
      void fetchAll()
    } catch (e) {
      setEditorError(errMsg(e, uiText("could_not_save_node_aab1bd8b")))
    } finally {
      setSaving(false)
    }
  }

  // ── Row actions ──────────────────────────────────────────────────

  const toggleEnabled = async (node: FabricNode) => {
    setTogglingId(node.id)
    try {
      // Re-sending the masked placement preserves the stored secrets.
      await settingsService.updateNode(node.id, {
        label: node.label,
        placement: node.placement,
        trust_level: node.trust_level,
        deploy: node.deploy,
        enabled: !node.enabled,
      })
      void fetchAll(true)
    } catch (e) {
      notify("err", uiText("could_not_change_enabled_state_733ce52b", { v0: errMsg(e, uiText("unknown_error")) }))
    } finally {
      setTogglingId(null)
    }
  }

  const deleteNode = async (id: string) => {
    try {
      await settingsService.deleteNode(id)
      notify("ok", uiText("node_deleted_ad977456"))
      void fetchAll(true)
    } catch (e) {
      notify("err", uiText("could_not_delete_node_182c9128", { v0: errMsg(e, uiText("unknown_error")) }))
    } finally {
      setConfirmDeleteId(null)
    }
  }

  const runAction = async (node: FabricNode, action: NodeAction) => {
    setPending({ id: node.id, action })
    try {
      const res = await settingsService.nodeAction(node.id, action)
      // `test` returns a preflight string (e.g. remote uname); surface it.
      const preflight =
        action === "test" && res && typeof res === "object" && "preflight" in res
          ? String((res as { preflight?: unknown }).preflight ?? "")
          : ""
      notify("ok", preflight ? uiText("connected_d82f3f8f", { v0: preflight }) : ACTION_OK[action])
      void fetchAll(true)
    } catch (e) {
      notify("err", uiText("failed_aaf317fd", { v0: ACTION_LABEL[action], v1: errMsg(e, uiText("unknown_error")) }))
    } finally {
      setPending(null)
    }
  }

  const showLogs = async (node: FabricNode) => {
    setLogsNode(node)
    setLogsOpen(true)
    setLogsLoading(true)
    setLogsText("")
    try {
      const res = await settingsService.nodeLogs(node.id, 200)
      setLogsText(res.logs || uiText("no_log_output_yet_fcfbdb9a"))
    } catch (e) {
      setLogsText(errMsg(e, uiText("could_not_read_logs_c9d4f6cd")))
    } finally {
      setLogsLoading(false)
    }
  }

  // ── Cluster editor ───────────────────────────────────────────────

  const openClusterCreate = () => {
    setClusterEditingName(null)
    setClusterName("")
    setClusterDesc("")
    setClusterNodeIds([])
    setClusterError(null)
    setClusterOpen(true)
  }

  const openClusterEdit = (c: FabricCluster) => {
    setClusterEditingName(c.name)
    setClusterName(c.name)
    setClusterDesc(c.description ?? "")
    setClusterNodeIds([...c.node_ids])
    setClusterError(null)
    setClusterOpen(true)
  }

  const closeClusterEditor = () => {
    setClusterOpen(false)
    setClusterEditingName(null)
    setClusterError(null)
  }

  const toggleMember = (id: string) =>
    setClusterNodeIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    )

  const saveCluster = async () => {
    const name = clusterName.trim()
    if (!name) {
      setClusterError(uiText("cluster_name_is_required_cbb7c731"))
      return
    }
    setClusterSaving(true)
    setClusterError(null)
    try {
      const req = {
        name,
        description: clusterDesc.trim() || undefined,
        node_ids: clusterNodeIds,
      }
      if (clusterEditingName) await settingsService.updateCluster(clusterEditingName, req)
      else await settingsService.createCluster(req)
      notify("ok", uiText("cluster_saved_84956917"))
      closeClusterEditor()
      void fetchAll()
    } catch (e) {
      // Membership failures surface HERE (in-dialog), distinct from node saves.
      setClusterError(uiText("could_not_save_cluster_membership_changes_did_not_take__22529f62", { v0: errMsg(e, uiText("unknown_error")) }))
    } finally {
      setClusterSaving(false)
    }
  }

  const removeCluster = async (name: string) => {
    try {
      await settingsService.deleteCluster(name)
      notify("ok", uiText("cluster_deleted_member_nodes_kept_58bda9cb"))
      void fetchAll(true)
    } catch (e) {
      notify("err", uiText("could_not_delete_cluster_f176a20e", { v0: errMsg(e, uiText("unknown_error")) }))
    } finally {
      setConfirmDeleteCluster(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  const isSshForm = form.placementType === "ssh"

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {uiText("register_local_or_remote_ssh_machines_to_deploy_worker__bf3f5b75")}</p>

      {notice ? (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
            notice.kind === "err"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-primary/30 bg-primary/10 text-primary",
          )}
        >
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{notice.text}</span>
          <button
            onClick={() => setNotice(null)}
            aria-label={uiText("dismiss_notification_d301bc12")}
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {loadError ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{loadError}</span>
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => void fetchAll()}>
            {uiText("retry_b8784c8d")}</Button>
        </div>
      ) : null}

      {/* ── Nodes ─────────────────────────────────────────────────── */}
      <section className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">{uiText("nodes_2410d860")}</div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              aria-label={uiText("refresh_aee88743")}
              onClick={() => void fetchAll()}
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
            <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={openCreate}>
              <Plus className="size-3.5" />{uiText("add_node_09da9abd")}</Button>
          </div>
        </div>

        {loading && nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
        ) : nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{uiText("no_nodes_yet_281309d3")}</p>
        ) : (
          <ul className="space-y-2">
            {nodes.map((node) => {
              const status = node.state?.status ?? "not_deployed"
              const meta = STATUS_META[status]
              const lastError = node.state?.last_error
              const lastSeen = sinceLabel(node.state?.last_health)
              const clusterOf = nodeClusterName.get(node.id)
              const busy = pending?.id === node.id
              return (
                <li key={node.id} className="space-y-1.5 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    {node.placement.type === "ssh" ? (
                      <Server className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Monitor className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {node.label}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn("border-transparent", meta.cls)}
                      title={
                        lastError && (status === "unreachable" || status === "failed")
                          ? lastError
                          : undefined
                      }
                    >
                      {meta.label}
                    </Badge>
                    <Switch
                      checked={node.enabled}
                      disabled={togglingId === node.id}
                      onCheckedChange={() => void toggleEnabled(node)}
                      aria-label={node.enabled ? uiText("disable_node_8a809f1d") : uiText("enable_node_b7e7cd5a")}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{placementText(node)}</span>
                    {clusterOf ? (
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                        {clusterOf}
                      </Badge>
                    ) : null}
                    {node.trust_level === "untrusted" ? (
                      <Badge variant="warning" className="h-4 px-1.5 text-[10px]">
                        {uiText("untrusted_1ddc3b8a")}</Badge>
                    ) : null}
                    {!node.enabled ? <span>{uiText("disabled_a8c3698b")}</span> : null}
                    {lastSeen ? <span>{uiText("last_active_30f38ff1")} {lastSeen}</span> : null}
                  </div>

                  {lastError && (status === "unreachable" || status === "failed") ? (
                    <p className="truncate text-xs text-destructive" title={lastError}>
                      {lastError}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {(["test", "deploy", "stop"] as const).map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-xs"
                        disabled={busy}
                        onClick={() => void runAction(node, action)}
                      >
                        {busy && pending?.action === action ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : null}
                        {ACTION_LABEL[action]}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-xs"
                      onClick={() => void showLogs(node)}
                    >
                      {uiText("logs_7dbac1c2")}</Button>
                    <div className="ml-auto flex items-center gap-1">
                      {confirmDeleteId === node.id ? (
                        <>
                          <span className="text-xs text-destructive">{uiText("confirm_deletion_2d61cf17")}</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-xs"
                            onClick={() => void deleteNode(node.id)}
                          >
                            {uiText("delete_2f9daa82")}</Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 text-xs"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            {uiText("cancel_2cd0f3be")}</Button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => openEdit(node)}
                            aria-label={uiText("edit_node_eca9fae8")}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(node.id)}
                            aria-label={uiText("delete_node_685e2d0b")}
                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Clusters ──────────────────────────────────────────────── */}
      <section className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">{uiText("clusters_5318ca46")}</div>
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={openClusterCreate}>
            <Plus className="size-3.5" />{uiText("add_cluster_0a87eec0")}</Button>
        </div>

        {clusters.length === 0 ? (
          <p className="text-xs text-muted-foreground">{uiText("no_clusters_yet_25b2d086")}</p>
        ) : (
          <ul className="space-y-2">
            {clusters.map((c) => {
              const memberLabels = c.node_ids
                .map((id) => nodes.find((n) => n.id === id)?.label ?? id)
                .join("、")
              return (
                <li key={c.name} className="flex items-center gap-2 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {uiText("count_nodes", { count: c.node_ids.length })} {memberLabels ? ` · ${memberLabels}` : ""}
                      {c.description ? ` · ${c.description}` : ""}
                    </div>
                  </div>
                  {confirmDeleteCluster === c.name ? (
                    <>
                      <span className="shrink-0 text-xs text-destructive">{uiText("confirm_deletion_2d61cf17")}</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => void removeCluster(c.name)}
                      >
                        {uiText("delete_2f9daa82")}</Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => setConfirmDeleteCluster(null)}
                      >
                        {uiText("cancel_2cd0f3be")}</Button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => openClusterEdit(c)}
                        aria-label={uiText("edit_cluster_28890c2b")}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteCluster(c.name)}
                        aria-label={uiText("delete_cluster_7ab3ed6c")}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Node editor dialog ────────────────────────────────────── */}
      <ResponsiveDialog
        open={editorOpen}
        onOpenChange={(o) => {
          if (!o) closeEditor()
        }}
      >
        <ResponsiveDialogContent className="p-5 sm:max-w-lg">
          <ResponsiveDialogTitle>{editingId ? uiText("edit_node_eca9fae8") : uiText("add_node_09da9abd")}</ResponsiveDialogTitle>
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1">
              <Label className="text-xs">{uiText("name_d44e9b3d")}</Label>
              <Input
                value={form.label}
                onChange={(e) => setField("label", e.target.value)}
                placeholder="gpu-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">{uiText("deployment_location_9d554c49")}</Label>
                <Select
                  value={form.placementType}
                  onValueChange={(v) => setField("placementType", v as NodeForm["placementType"])}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssh">{uiText("ssh_remote_563675ae")}</SelectItem>
                    <SelectItem value="local">{uiText("local_8a94c4a1")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{uiText("trust_level_ca9df95a")}</Label>
                <Select
                  value={form.trustLevel}
                  onValueChange={(v) => setField("trustLevel", v as TrustLevel)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trusted">{uiText("trusted_8627bad4")}</SelectItem>
                    <SelectItem value="untrusted">{uiText("untrusted_1ddc3b8a")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isSshForm ? (
              <>
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{uiText("host_e87d9f23")}</Label>
                    <Input
                      value={form.host}
                      onChange={(e) => setField("host", e.target.value)}
                      placeholder="10.0.0.5"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{uiText("port_e71ac32b")}</Label>
                    <Input
                      inputMode="numeric"
                      value={form.port}
                      onChange={(e) => setField("port", e.target.value)}
                      placeholder="22"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">{uiText("username_1a3f0617")}</Label>
                  <Input
                    value={form.username}
                    onChange={(e) => setField("username", e.target.value)}
                    placeholder="deploy"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">{uiText("authentication_d1ff8f98")}</Label>
                  <Select
                    value={form.authMethod}
                    onValueChange={(v) => setField("authMethod", v as NodeForm["authMethod"])}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">{uiText("password_a621ab60")}</SelectItem>
                      <SelectItem value="private_key">{uiText("private_key_3ffe935f")}</SelectItem>
                      <SelectItem value="system_ssh_config">{uiText("use_local_ssh_configuration_0acb0e3d")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.authMethod === "password" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">{uiText("password_a621ab60")}</Label>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setField("password", e.target.value)}
                      placeholder={
                        editingOriginalAuth?.method === "password"
                          ? uiText("leave_blank_to_keep_the_existing_password_66c2200e")
                          : undefined
                      }
                    />
                  </div>
                ) : null}

                {form.authMethod === "private_key" ? (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs">{uiText("private_key_file_path_local_4f44a132")}</Label>
                      <Input
                        value={form.privateKeyPath}
                        onChange={(e) => setField("privateKeyPath", e.target.value)}
                        placeholder="~/.ssh/id_ed25519"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{uiText("or_paste_a_private_key_pem_5e7cf830")}</Label>
                      <Textarea
                        className="min-h-16 resize-y font-mono text-xs"
                        value={form.privateKey}
                        onChange={(e) => setField("privateKey", e.target.value)}
                        placeholder={
                          editingOriginalAuth?.method === "private_key"
                            ? uiText("leave_blank_to_keep_the_existing_private_key_7f685d0b")
                            : "-----BEGIN OPENSSH PRIVATE KEY-----"
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{uiText("private_key_passphrase_optional_8138fad9")}</Label>
                      <Input
                        type="password"
                        value={form.passphrase}
                        onChange={(e) => setField("passphrase", e.target.value)}
                        placeholder={
                          editingOriginalAuth?.method === "private_key"
                            ? uiText("leave_blank_to_keep_the_existing_passphrase_a50f11c8")
                            : undefined
                        }
                      />
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
              <div className="text-xs font-medium text-muted-foreground">{uiText("deployment_settings_ccbf90f5")}</div>
              <div className="space-y-1">
                <Label className="text-xs">{uiText("artifact_path_bamboo_binary_to_upload_a8a61a77")}</Label>
                <Input
                  value={form.artifactPath}
                  onChange={(e) => setField("artifactPath", e.target.value)}
                  placeholder="/path/to/bamboo-linux-x64"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{uiText("remote_directory_1cfa6840")}</Label>
                  <Input
                    value={form.remoteDir}
                    onChange={(e) => setField("remoteDir", e.target.value)}
                    placeholder="~/.bamboo-worker"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{uiText("default_role_8a2a6551")}</Label>
                  <Input
                    value={form.defaultRole}
                    onChange={(e) => setField("defaultRole", e.target.value)}
                    placeholder="worker"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{uiText("model_c98e118e")}</Label>
                  <Input
                    value={form.model}
                    onChange={(e) => setField("model", e.target.value)}
                    placeholder={uiText("default_844b8cc8")}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{uiText("working_directory_3db7b06b")}</Label>
                  <Input
                    value={form.workspace}
                    onChange={(e) => setField("workspace", e.target.value)}
                    placeholder={uiText("default_844b8cc8")}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium">{uiText("automatic_recovery_d4670a4c")}</div>
                  <p className="text-xs text-muted-foreground">
                    {uiText("redeploy_automatically_when_health_checks_detect_a_disc_46daaed1")}</p>
                </div>
                <Switch
                  checked={form.autoRecover}
                  onCheckedChange={(v) => setField("autoRecover", v)}
                  aria-label={uiText("automatic_recovery_d4670a4c")}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium">{uiText("enabled_f4f0ead1")}</div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setField("enabled", v)}
                aria-label={uiText("enable_node_b7e7cd5a")}
              />
            </div>
          </div>

          {editorError ? <p className="mt-2 text-xs text-destructive">{editorError}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeEditor}>
              {uiText("cancel_2cd0f3be")}</Button>
            <Button onClick={() => void saveNode()} disabled={saving}>
              {saving ? uiText("saving_ff509c9b") : uiText("save_a3030bf8")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Logs dialog ───────────────────────────────────────────── */}
      <ResponsiveDialog
        open={logsOpen}
        onOpenChange={(o) => {
          if (!o) setLogsOpen(false)
        }}
      >
        <ResponsiveDialogContent className="p-5 sm:max-w-2xl">
          <ResponsiveDialogTitle>{uiText("logs_8a81380a")} {logsNode?.label ?? ""}</ResponsiveDialogTitle>
          <div className="mt-3 max-h-[50vh] min-h-24 flex-1 overflow-auto rounded-md border bg-muted/30 p-2">
            {logsLoading ? (
              <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
            ) : (
              <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {logsText}
              </pre>
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setLogsOpen(false)}>
              {uiText("close_3fd47edc")}</Button>
            <Button
              disabled={logsLoading}
              onClick={() => {
                if (logsNode) void showLogs(logsNode)
              }}
            >
              {uiText("refresh_aee88743")}</Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Cluster editor dialog ─────────────────────────────────── */}
      <ResponsiveDialog
        open={clusterOpen}
        onOpenChange={(o) => {
          if (!o) closeClusterEditor()
        }}
      >
        <ResponsiveDialogContent className="p-5">
          <ResponsiveDialogTitle>
            {clusterEditingName ? uiText("edit_cluster_28890c2b") : uiText("add_cluster_0a87eec0")}
          </ResponsiveDialogTitle>
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1">
              <Label className="text-xs">{uiText("name_d44e9b3d")}</Label>
              <Input
                value={clusterName}
                disabled={!!clusterEditingName}
                onChange={(e) => setClusterName(e.target.value)}
                placeholder="gpu-pool"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{uiText("description_optional_8b29dbed")}</Label>
              <Input
                value={clusterDesc}
                onChange={(e) => setClusterDesc(e.target.value)}
                placeholder={uiText("purpose_0bef9631")}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{uiText("member_nodes_658ff86e")}</Label>
              {nodes.length === 0 ? (
                <p className="text-xs text-muted-foreground">{uiText("no_nodes_yet_add_a_node_first_d769d2c5")}</p>
              ) : (
                <div className="space-y-1.5">
                  {nodes.map((n) => {
                    const checked = clusterNodeIds.includes(n.id)
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => toggleMember(n.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                          checked ? "border-primary/50 bg-primary/5" : "hover:bg-accent/50",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded border",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/40",
                          )}
                        >
                          {checked ? <Check className="size-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{n.label}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {placementText(n)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {clusterError ? <p className="mt-2 text-xs text-destructive">{clusterError}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeClusterEditor}>
              {uiText("cancel_2cd0f3be")}</Button>
            <Button onClick={() => void saveCluster()} disabled={clusterSaving}>
              {clusterSaving ? uiText("saving_ff509c9b") : uiText("save_a3030bf8")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
