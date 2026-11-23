import { createMemo, createSignal, onSettled } from "solid-js"
import { settingsService, type FabricCluster, type FabricNode } from "@services/config/SettingsService"
import { createUiText } from "../../shell/uiText"
import { buildNodeRequest, nodeForm, redactNodeCredentials, validateNodeForm, type NodeForm } from "./nodeForm"

export const ACTION_LABEL = {
  test: "test_6aa8f49c",
  deploy: "deploy_3ca77185",
  stop: "stop_ca4d973c",
} as const
const ACTION_OK = {
  test: "connected_successfully_4a19cb8a",
  deploy: "deployment_triggered_7e32b41b",
  stop: "stop_triggered_72121661",
} as const

type NodeAction = keyof typeof ACTION_LABEL
type Operation =
  | { kind: "action"; id: string; action: NodeAction }
  | { kind: "toggle" | "delete-node"; id: string }
  | { kind: "save-node" | "save-cluster" | "delete-cluster" }
type NodeEditor = { original?: FabricNode; form: NodeForm; error?: string }
type ClusterEditor = { originalName?: string; name: string; description: string; members: string[]; error?: string }
type Logs = { id: string; label: string; loading: boolean; content: string }

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function createClusterFabric() {
  const text = createUiText()
  const [nodes, setNodes] = createSignal<FabricNode[]>([])
  const [clusters, setClusters] = createSignal<FabricCluster[]>([])
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string>()
  const [notice, setNotice] = createSignal<{ kind: "ok" | "err"; text: string }>()
  const [operation, setOperation] = createSignal<Operation>()
  const [nodeEditor, setNodeEditor] = createSignal<NodeEditor>()
  const [clusterEditor, setClusterEditor] = createSignal<ClusterEditor>()
  const [logs, setLogs] = createSignal<Logs>()
  const [deleteTarget, setDeleteTarget] = createSignal<{ kind: "node" | "cluster"; id: string }>()
  let writing = false
  let mounted = true
  let fetchSequence = 0
  let logSequence = 0
  let noticeTimer: number | undefined

  const nodeClusters = createMemo(() => {
    const names = new Map<string, string>()
    for (const cluster of clusters()) {
      for (const id of cluster.node_ids) {
        if (!names.has(id)) names.set(id, cluster.name)
      }
    }
    return names
  })

  function dismissNotice() {
    window.clearTimeout(noticeTimer)
    setNotice(undefined)
  }

  function notify(kind: "ok" | "err", message: string) {
    if (!mounted) return
    dismissNotice()
    setNotice({ kind, text: message })
    if (kind === "ok") noticeTimer = window.setTimeout(dismissNotice, 4_000)
  }

  async function refresh(silent = false) {
    if (!mounted) return
    const sequence = ++fetchSequence
    if (!silent) setLoading(true)
    try {
      const result = await settingsService.listNodes()
      if (!mounted || sequence !== fetchSequence) return
      setNodes((result.nodes ?? []).map(redactNodeCredentials))
      setClusters(result.clusters ?? [])
      setLoadError(undefined)
    } catch (error) {
      if (mounted && sequence === fetchSequence && !silent) {
        setLoadError(errorMessage(error, text("could_not_load_cluster_settings_96bba618")))
      }
    } finally {
      if (mounted && sequence === fetchSequence) setLoading(false)
    }
  }

  onSettled(() => {
    void refresh()
    const tick = () => {
      if (mounted && document.visibilityState === "visible" && !writing && !nodeEditor() && !clusterEditor() && !logs()) {
        void refresh(true)
      }
    }
    const timer = window.setInterval(tick, 30_000)
    document.addEventListener("visibilitychange", tick)
    return () => {
      mounted = false
      window.clearInterval(timer)
      window.clearTimeout(noticeTimer)
      document.removeEventListener("visibilitychange", tick)
      setNodeEditor(undefined)
      setClusterEditor(undefined)
      setLogs(undefined)
    }
  })

  function start(next: Operation) {
    if (!mounted || writing) return false
    writing = true
    setOperation(next)
    return true
  }

  function finish() {
    writing = false
    if (mounted) setOperation(undefined)
  }

  function openNode(node?: FabricNode) {
    if (!mounted || writing) return
    setDeleteTarget(undefined)
    setNodeEditor({ original: node, form: nodeForm(node) })
  }

  function closeNode() {
    if (!writing) setNodeEditor(undefined)
  }

  function setNodeField<K extends keyof NodeForm>(field: K, value: NodeForm[K]) {
    if (writing) return
    setNodeEditor((editor) => editor && { ...editor, form: { ...editor.form, [field]: value } })
  }

  async function saveNode() {
    const editor = nodeEditor()
    if (!editor || writing) return
    const original = editor.original
    const auth = original?.placement.type === "ssh" ? original.placement.auth : undefined
    const error = validateNodeForm(editor.form, auth, text)
    if (error) {
      setNodeEditor({ ...editor, error })
      return
    }
    if (!start({ kind: "save-node" })) return
    setNodeEditor({ ...editor, error: undefined })
    try {
      const payload = buildNodeRequest(editor.form, original)
      if (original) await settingsService.updateNode(original.id, payload)
      else await settingsService.createNode(payload)
      if (!mounted) return
      setNodeEditor(undefined)
      notify("ok", text(original ? "node_updated_726bbf53" : "node_created_a2d136da"))
      await refresh(true)
    } catch {
      // A mutation error may contain the submitted SSH credentials.
      if (mounted) setNodeEditor({ ...editor, error: text("could_not_save_node_aab1bd8b") })
    } finally { finish() }
  }

  async function toggleNode(node: FabricNode, enabled: boolean) {
    if (node.enabled === enabled || !start({ kind: "toggle", id: node.id })) return
    try {
      await settingsService.updateNode(node.id, {
        label: node.label, placement: node.placement, trust_level: node.trust_level, deploy: node.deploy, enabled,
      })
      await refresh(true)
    } catch (error) {
      notify("err", text("could_not_change_enabled_state_733ce52b", { v0: errorMessage(error, text("unknown_error")) }))
    } finally { finish() }
  }

  async function runAction(node: FabricNode, action: NodeAction) {
    if (!start({ kind: "action", id: node.id, action })) return
    try {
      const result = await settingsService.nodeAction(node.id, action)
      const preflight = action === "test" && result && typeof result === "object" && "preflight" in result
        ? String(result.preflight ?? "") : ""
      notify("ok", preflight ? text("connected_d82f3f8f", { v0: preflight }) : text(ACTION_OK[action]))
      await refresh(true)
    } catch (error) {
      notify("err", text("failed_aaf317fd", { v0: text(ACTION_LABEL[action]), v1: errorMessage(error, text("unknown_error")) }))
    } finally { finish() }
  }

  function closeLogs() {
    logSequence += 1
    setLogs(undefined)
  }

  async function readLogs(node: Pick<FabricNode, "id" | "label">) {
    if (!mounted) return
    const sequence = ++logSequence
    setLogs({ id: node.id, label: node.label, loading: true, content: "" })
    let content: string
    try {
      const result = await settingsService.nodeLogs(node.id, 200)
      content = result.logs || text("no_log_output_yet_fcfbdb9a")
    } catch (error) {
      content = errorMessage(error, text("could_not_read_logs_c9d4f6cd"))
    }
    if (mounted && sequence === logSequence) setLogs({ id: node.id, label: node.label, loading: false, content })
  }

  function openCluster(cluster?: FabricCluster) {
    if (!mounted || writing) return
    setDeleteTarget(undefined)
    setClusterEditor({
      originalName: cluster?.name, name: cluster?.name ?? "", description: cluster?.description ?? "", members: cluster ? [...cluster.node_ids] : [],
    })
  }

  function closeCluster() {
    if (!writing) setClusterEditor(undefined)
  }

  function setClusterField(field: "name" | "description", value: string) {
    if (writing) return
    setClusterEditor((editor) => editor && { ...editor, [field]: value })
  }

  function toggleMember(id: string) {
    if (writing) return
    setClusterEditor((editor) => editor && {
      ...editor, members: editor.members.includes(id) ? editor.members.filter((member) => member !== id) : [...editor.members, id],
    })
  }

  async function saveCluster() {
    const editor = clusterEditor()
    if (!editor || writing) return
    const name = editor.name.trim()
    if (!name) {
      setClusterEditor({ ...editor, error: text("cluster_name_is_required_cbb7c731") })
      return
    }
    if (!start({ kind: "save-cluster" })) return
    setClusterEditor({ ...editor, error: undefined })
    try {
      const payload = { name, description: editor.description.trim() || undefined, node_ids: editor.members }
      if (editor.originalName) await settingsService.updateCluster(editor.originalName, payload)
      else await settingsService.createCluster(payload)
      if (!mounted) return
      setClusterEditor(undefined)
      notify("ok", text("cluster_saved_84956917"))
      await refresh(true)
    } catch (error) {
      if (mounted) setClusterEditor({ ...editor, error: text("could_not_save_cluster_membership_changes_did_not_take__22529f62", {
        v0: errorMessage(error, text("unknown_error")),
      }) })
    } finally { finish() }
  }

  function requestDelete(kind: "node" | "cluster", id: string) {
    if (!writing) setDeleteTarget({ kind, id })
  }

  function cancelDelete() {
    if (!writing) setDeleteTarget(undefined)
  }

  async function confirmDelete(kind: "node" | "cluster", id: string) {
    const target = deleteTarget()
    if (target?.kind !== kind || target.id !== id) return
    if (!start(kind === "node" ? { kind: "delete-node", id } : { kind: "delete-cluster" })) return
    try {
      if (kind === "node") await settingsService.deleteNode(id)
      else await settingsService.deleteCluster(id)
      notify("ok", text(kind === "node" ? "node_deleted_ad977456" : "cluster_deleted_member_nodes_kept_58bda9cb"))
      await refresh(true)
    } catch (error) {
      notify("err", text(kind === "node" ? "could_not_delete_node_182c9128" : "could_not_delete_cluster_f176a20e", {
        v0: errorMessage(error, text("unknown_error")),
      }))
    } finally {
      if (mounted) setDeleteTarget(undefined)
      finish()
    }
  }

  return {
    text, nodes, clusters, loading, loadError, notice, nodeClusters, operation, nodeEditor, clusterEditor, logs, deleteTarget,
    refresh, dismissNotice, openNode, closeNode, setNodeField, saveNode, toggleNode, runAction, readLogs, closeLogs,
    openCluster, closeCluster, setClusterField, toggleMember, saveCluster, requestDelete, cancelDelete, confirmDelete,
  }
}

export type ClusterFabric = ReturnType<typeof createClusterFabric>
