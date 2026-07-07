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
  not_deployed: { label: "未部署", cls: "bg-muted text-muted-foreground" },
  deploying: {
    label: "部署中",
    cls: "animate-pulse bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  running: { label: "运行中", cls: "bg-primary/15 text-primary" },
  unreachable: {
    label: "不可达",
    cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  stopped: { label: "已停止", cls: "bg-muted text-muted-foreground" },
  failed: { label: "失败", cls: "bg-destructive/15 text-destructive" },
}

type NodeAction = "test" | "deploy" | "stop"

const ACTION_LABEL: Record<NodeAction, string> = {
  test: "测试",
  deploy: "部署",
  stop: "停止",
}

const ACTION_OK: Record<NodeAction, string> = {
  test: "连接成功",
  deploy: "部署已触发",
  stop: "停止已触发",
}

/** Coarse "N 前" from an RFC3339 timestamp (recomputed each render / poll). */
function sinceLabel(iso?: string): string {
  if (!iso) return ""
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}秒前`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}小时前`
  return `${Math.floor(hrs / 24)}天前`
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function placementText(node: FabricNode): string {
  return node.placement.type === "ssh"
    ? `${node.placement.username}@${node.placement.host}:${node.placement.port}`
    : "本机"
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
        setLoadError(errMsg(e, "加载集群配置失败"))
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
    if (!f.label.trim()) return "名称不能为空"
    if (f.placementType === "ssh") {
      if (!f.host.trim()) return "主机不能为空"
      if (!f.username.trim()) return "用户名不能为空"
      const port = Number(f.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) return "端口必须是 1-65535"
      if (f.authMethod === "password") {
        const hasExisting =
          editingOriginalAuth?.method === "password" && Boolean(editingOriginalAuth.password)
        if (!f.password && !hasExisting) return "密码不能为空"
      }
      if (f.authMethod === "private_key") {
        const hasEntered = Boolean(f.privateKey.trim() || f.privateKeyPath.trim())
        const hasExisting =
          editingOriginalAuth?.method === "private_key" &&
          Boolean(editingOriginalAuth.private_key || editingOriginalAuth.private_key_path)
        if (!hasEntered && !hasExisting) return "需要提供私钥内容或私钥文件路径"
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
      notify("ok", editingId ? "节点已更新" : "节点已创建")
      closeEditor()
      void fetchAll()
    } catch (e) {
      setEditorError(errMsg(e, "保存节点失败"))
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
      notify("err", `切换启用状态失败:${errMsg(e, "未知错误")}`)
    } finally {
      setTogglingId(null)
    }
  }

  const deleteNode = async (id: string) => {
    try {
      await settingsService.deleteNode(id)
      notify("ok", "节点已删除")
      void fetchAll(true)
    } catch (e) {
      notify("err", `删除节点失败:${errMsg(e, "未知错误")}`)
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
      notify("ok", preflight ? `连接成功:${preflight}` : ACTION_OK[action])
      void fetchAll(true)
    } catch (e) {
      notify("err", `${ACTION_LABEL[action]}失败:${errMsg(e, "未知错误")}`)
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
      setLogsText(res.logs || "(暂无日志输出)")
    } catch (e) {
      setLogsText(errMsg(e, "读取日志失败"))
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
      setClusterError("集群名称不能为空")
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
      notify("ok", "集群已保存")
      closeClusterEditor()
      void fetchAll()
    } catch (e) {
      // Membership failures surface HERE (in-dialog), distinct from node saves.
      setClusterError(`保存集群失败(成员关系未生效):${errMsg(e, "未知错误")}`)
    } finally {
      setClusterSaving(false)
    }
  }

  const removeCluster = async (name: string) => {
    try {
      await settingsService.deleteCluster(name)
      notify("ok", "集群已删除(成员节点保留)")
      void fetchAll(true)
    } catch (e) {
      notify("err", `删除集群失败:${errMsg(e, "未知错误")}`)
    } finally {
      setConfirmDeleteCluster(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  const isSshForm = form.placementType === "ssh"

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        注册本机或 SSH 远程机器,用于部署 worker 代理。SSH 凭据由后端加密存储,不会明文返回。
      </p>

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
            aria-label="关闭提示"
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
            重试
          </Button>
        </div>
      ) : null}

      {/* ── Nodes ─────────────────────────────────────────────────── */}
      <section className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">节点</div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              aria-label="刷新"
              onClick={() => void fetchAll()}
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
            <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={openCreate}>
              <Plus className="size-3.5" /> 新增节点
            </Button>
          </div>
        </div>

        {loading && nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : nodes.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无节点</p>
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
                      aria-label={node.enabled ? "停用节点" : "启用节点"}
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
                        不受信任
                      </Badge>
                    ) : null}
                    {!node.enabled ? <span>已停用</span> : null}
                    {lastSeen ? <span>活跃于 {lastSeen}</span> : null}
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
                      日志
                    </Button>
                    <div className="ml-auto flex items-center gap-1">
                      {confirmDeleteId === node.id ? (
                        <>
                          <span className="text-xs text-destructive">确认删除?</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-xs"
                            onClick={() => void deleteNode(node.id)}
                          >
                            删除
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 text-xs"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            取消
                          </Button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => openEdit(node)}
                            aria-label="编辑节点"
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(node.id)}
                            aria-label="删除节点"
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
          <div className="text-xs font-medium text-muted-foreground">集群</div>
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={openClusterCreate}>
            <Plus className="size-3.5" /> 新增集群
          </Button>
        </div>

        {clusters.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无集群</p>
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
                      {c.node_ids.length} 个节点
                      {memberLabels ? ` · ${memberLabels}` : ""}
                      {c.description ? ` · ${c.description}` : ""}
                    </div>
                  </div>
                  {confirmDeleteCluster === c.name ? (
                    <>
                      <span className="shrink-0 text-xs text-destructive">确认删除?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => void removeCluster(c.name)}
                      >
                        删除
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => setConfirmDeleteCluster(null)}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => openClusterEdit(c)}
                        aria-label="编辑集群"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteCluster(c.name)}
                        aria-label="删除集群"
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
          <ResponsiveDialogTitle>{editingId ? "编辑节点" : "新增节点"}</ResponsiveDialogTitle>
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1">
              <Label className="text-xs">名称</Label>
              <Input
                value={form.label}
                onChange={(e) => setField("label", e.target.value)}
                placeholder="gpu-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">部署位置</Label>
                <Select
                  value={form.placementType}
                  onValueChange={(v) => setField("placementType", v as NodeForm["placementType"])}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssh">SSH(远程)</SelectItem>
                    <SelectItem value="local">本机</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">信任级别</Label>
                <Select
                  value={form.trustLevel}
                  onValueChange={(v) => setField("trustLevel", v as TrustLevel)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trusted">受信任</SelectItem>
                    <SelectItem value="untrusted">不受信任</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isSshForm ? (
              <>
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">主机</Label>
                    <Input
                      value={form.host}
                      onChange={(e) => setField("host", e.target.value)}
                      placeholder="10.0.0.5"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">端口</Label>
                    <Input
                      inputMode="numeric"
                      value={form.port}
                      onChange={(e) => setField("port", e.target.value)}
                      placeholder="22"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">用户名</Label>
                  <Input
                    value={form.username}
                    onChange={(e) => setField("username", e.target.value)}
                    placeholder="deploy"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">认证方式</Label>
                  <Select
                    value={form.authMethod}
                    onValueChange={(v) => setField("authMethod", v as NodeForm["authMethod"])}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">密码</SelectItem>
                      <SelectItem value="private_key">私钥</SelectItem>
                      <SelectItem value="system_ssh_config">使用本机 SSH 配置</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.authMethod === "password" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">密码</Label>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setField("password", e.target.value)}
                      placeholder={
                        editingOriginalAuth?.method === "password"
                          ? "留空保持原有密码"
                          : undefined
                      }
                    />
                  </div>
                ) : null}

                {form.authMethod === "private_key" ? (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs">私钥文件路径(本机)</Label>
                      <Input
                        value={form.privateKeyPath}
                        onChange={(e) => setField("privateKeyPath", e.target.value)}
                        placeholder="~/.ssh/id_ed25519"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">…或粘贴私钥(PEM)</Label>
                      <Textarea
                        className="min-h-16 resize-y font-mono text-xs"
                        value={form.privateKey}
                        onChange={(e) => setField("privateKey", e.target.value)}
                        placeholder={
                          editingOriginalAuth?.method === "private_key"
                            ? "留空保持原有私钥"
                            : "-----BEGIN OPENSSH PRIVATE KEY-----"
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">私钥口令(可选)</Label>
                      <Input
                        type="password"
                        value={form.passphrase}
                        onChange={(e) => setField("passphrase", e.target.value)}
                        placeholder={
                          editingOriginalAuth?.method === "private_key"
                            ? "留空保持原有口令"
                            : undefined
                        }
                      />
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
              <div className="text-xs font-medium text-muted-foreground">部署配置</div>
              <div className="space-y-1">
                <Label className="text-xs">Artifact 路径(要上传的 bamboo 二进制)</Label>
                <Input
                  value={form.artifactPath}
                  onChange={(e) => setField("artifactPath", e.target.value)}
                  placeholder="/path/to/bamboo-linux-x64"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">远程目录</Label>
                  <Input
                    value={form.remoteDir}
                    onChange={(e) => setField("remoteDir", e.target.value)}
                    placeholder="~/.bamboo-worker"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">默认角色</Label>
                  <Input
                    value={form.defaultRole}
                    onChange={(e) => setField("defaultRole", e.target.value)}
                    placeholder="worker"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">模型</Label>
                  <Input
                    value={form.model}
                    onChange={(e) => setField("model", e.target.value)}
                    placeholder="默认"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">工作目录</Label>
                  <Input
                    value={form.workspace}
                    onChange={(e) => setField("workspace", e.target.value)}
                    placeholder="默认"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium">自动恢复</div>
                  <p className="text-xs text-muted-foreground">
                    健康检查发现 worker 掉线时自动重新部署。
                  </p>
                </div>
                <Switch
                  checked={form.autoRecover}
                  onCheckedChange={(v) => setField("autoRecover", v)}
                  aria-label="自动恢复"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium">启用</div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setField("enabled", v)}
                aria-label="启用节点"
              />
            </div>
          </div>

          {editorError ? <p className="mt-2 text-xs text-destructive">{editorError}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeEditor}>
              取消
            </Button>
            <Button onClick={() => void saveNode()} disabled={saving}>
              {saving ? "保存中…" : "保存"}
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
          <ResponsiveDialogTitle>日志 — {logsNode?.label ?? ""}</ResponsiveDialogTitle>
          <div className="mt-3 max-h-[50vh] min-h-24 flex-1 overflow-auto rounded-md border bg-muted/30 p-2">
            {logsLoading ? (
              <p className="text-xs text-muted-foreground">加载中…</p>
            ) : (
              <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {logsText}
              </pre>
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setLogsOpen(false)}>
              关闭
            </Button>
            <Button
              disabled={logsLoading}
              onClick={() => {
                if (logsNode) void showLogs(logsNode)
              }}
            >
              刷新
            </Button>
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
            {clusterEditingName ? "编辑集群" : "新增集群"}
          </ResponsiveDialogTitle>
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1">
              <Label className="text-xs">名称</Label>
              <Input
                value={clusterName}
                disabled={!!clusterEditingName}
                onChange={(e) => setClusterName(e.target.value)}
                placeholder="gpu-pool"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">描述(可选)</Label>
              <Input
                value={clusterDesc}
                onChange={(e) => setClusterDesc(e.target.value)}
                placeholder="用途说明"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">成员节点</Label>
              {nodes.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无节点,请先新增节点</p>
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
              取消
            </Button>
            <Button onClick={() => void saveCluster()} disabled={clusterSaving}>
              {clusterSaving ? "保存中…" : "保存"}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
