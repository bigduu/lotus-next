import type { FabricNode, NodePlacement, NodeUpsertRequest, SshAuth, TrustLevel } from "@services/config/SettingsService"
import type { createUiText } from "../../shell/uiText"

const SECRET_MASK = "****...****"

export interface NodeForm {
  label: string
  placementType: "local" | "ssh"
  host: string
  port: string
  username: string
  authMethod: SshAuth["method"]
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

export function nodeForm(node?: FabricNode): NodeForm {
  const remote = node?.placement.type === "ssh" ? node.placement : undefined
  return {
    label: node?.label ?? "",
    placementType: node?.placement.type ?? "ssh",
    host: remote?.host ?? "",
    port: String(remote?.port ?? 22),
    username: remote?.username ?? "",
    authMethod: remote?.auth.method ?? "password",
    password: "",
    privateKey: "",
    privateKeyPath: remote?.auth.method === "private_key" ? remote.auth.private_key_path ?? "" : "",
    passphrase: "",
    trustLevel: node?.trust_level ?? "trusted",
    artifactPath: node?.deploy?.artifact_path ?? "",
    remoteDir: node?.deploy?.remote_dir ?? "",
    defaultRole: node?.deploy?.default_role ?? "",
    model: node?.deploy?.model ?? "",
    workspace: node?.deploy?.workspace ?? "",
    autoRecover: node?.deploy?.auto_recover ?? false,
    enabled: node?.enabled ?? true,
  }
}

export function validateNodeForm(form: NodeForm, originalAuth: SshAuth | undefined, text: ReturnType<typeof createUiText>): string | undefined {
  if (!form.label.trim()) return text("name_is_required_e8365416")
  if (form.placementType === "local") return undefined
  if (!form.host.trim()) return text("host_is_required_0c6a959b")
  if (!form.username.trim()) return text("username_is_required_390ccdec")
  const port = Number(form.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return text("port_must_be_between_1_and_65535_2cc08f2a")

  if (form.authMethod === "password" && !form.password && !(originalAuth?.method === "password" && originalAuth.password)) {
    return text("password_is_required_3aa7a9e0")
  }
  if (form.authMethod === "private_key" && !(form.privateKey.trim() || form.privateKeyPath.trim()) &&
      !(originalAuth?.method === "private_key" && (originalAuth.private_key || originalAuth.private_key_path))) {
    return text("provide_private_key_content_or_a_private_key_file_path_e183c9eb")
  }
  return undefined
}

function placement(form: NodeForm, original: NodePlacement | undefined): NodePlacement {
  if (form.placementType === "local") return { type: "local" }
  const prior = original?.type === "ssh" ? original : undefined
  const oldAuth = prior?.auth
  let auth: SshAuth
  switch (form.authMethod) {
    case "password":
      auth = { method: "password", password: form.password || (oldAuth?.method === "password" && oldAuth.password ? SECRET_MASK : "") }
      break
    case "private_key":
      auth = {
        method: "private_key",
        private_key: form.privateKey || (oldAuth?.method === "private_key" && oldAuth.private_key ? SECRET_MASK : undefined),
        private_key_path: form.privateKeyPath.trim() || undefined,
        passphrase: form.passphrase || (oldAuth?.method === "private_key" && oldAuth.passphrase ? SECRET_MASK : undefined),
      }
      break
    case "system_ssh_config":
      auth = { method: "system_ssh_config" }
      break
  }
  const host = form.host.trim()
  const port = Number(form.port)
  return {
    type: "ssh", host, port, username: form.username.trim(), auth,
    host_key_fingerprint: prior?.host === host && prior.port === port ? prior.host_key_fingerprint : undefined,
  }
}

export function buildNodeRequest(form: NodeForm, original: FabricNode | undefined): NodeUpsertRequest {
  return {
    label: form.label.trim(), placement: placement(form, original?.placement), trust_level: form.trustLevel, enabled: form.enabled,
    deploy: {
      artifact_path: form.artifactPath.trim() || undefined,
      artifact_sha256: original?.deploy?.artifact_sha256,
      remote_dir: form.remoteDir.trim() || undefined,
      default_role: form.defaultRole.trim() || undefined,
      model: form.model.trim() || undefined,
      workspace: form.workspace.trim() || undefined,
      auto_recover: form.autoRecover,
    },
  }
}

/** Retain only whether a secret exists, even when a backend response is malformed. */
export function redactNodeCredentials(node: FabricNode): FabricNode {
  const target = node.placement
  if (target.type !== "ssh") return node
  const auth = target.auth
  if (auth.method === "system_ssh_config") return node
  const masked = auth.method === "password" ? {
    method: auth.method, password: auth.password ? SECRET_MASK : undefined,
  } : {
    method: auth.method, private_key_path: auth.private_key_path,
    private_key: auth.private_key ? SECRET_MASK : undefined, passphrase: auth.passphrase ? SECRET_MASK : undefined,
  }
  return { ...node, placement: { ...target, auth: masked } }
}
