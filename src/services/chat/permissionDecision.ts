import type { PermissionDecisionRequest, PermissionRequest } from "./AgentService"
import type { AssistantToolResultMessage } from "@shared/types/chatMessages"

export function permissionDecisionFor(request: PermissionRequest, choice: string): PermissionDecisionRequest | null {
  if (!request.allowed_decisions.includes(choice)) return null
  const identity = {
    request_id: request.request_id,
    request_generation: request.request_generation,
    expected_policy_revision: request.policy_revision,
  }
  if (choice === "allow_once" || choice === "deny_once") return { ...identity, decision: choice }
  if (choice === "allow_session" && Array.isArray(request.suggested_matchers)
      && request.suggested_matchers.some((matcher) => matcher?.id === "exact_resource" && matcher.kind === "exact_resource")) {
    return { ...identity, decision: choice, matcher_id: "exact_resource" }
  }
  return null
}

export function permissionOperation(request: Pick<PermissionRequest, "tool_name" | "resource" | "operation_summary">,
  value: unknown, workspace?: string | null) {
  const args = record(value)
  const shell = request.tool_name === "exec_command" || request.tool_name === "Bash"
  const command = typeof args?.cmd === "string" && args.cmd.trim() ? args.cmd : request.resource
  const workdir = args?.workdir ?? workspace
  return {
    operation: shell && command ? command : request.operation_summary,
    workingDirectory: typeof workdir === "string" && workdir.trim() ? workdir : undefined,
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function permissionHistoryFromMetadata(sessionId: string, callId: string, metadata?: Record<string, unknown>):
  AssistantToolResultMessage["permissionHistory"] {
  const request = record(metadata?.permission_request)
  if (!request || request.session_id !== sessionId || request.request_id !== callId
      || typeof request.request_generation !== "string" || !request.request_generation
      || typeof request.tool_name !== "string" || typeof request.resource !== "string"
      || typeof request.operation_summary !== "string") return undefined

  const receipt = record(metadata?.permission_decision_receipt)
  const recorded = record(receipt?.decision)
  const decision = recorded?.decision
  const matches = receipt?.session_id === sessionId && recorded?.request_id === callId
    && recorded?.request_generation === request.request_generation
  return {
    requestId: callId, generation: request.request_generation,
    ...permissionOperation({ tool_name: request.tool_name, resource: request.resource,
      operation_summary: request.operation_summary }, null,
    typeof request.workspace_path === "string" ? request.workspace_path : undefined),
    decision: matches && (decision === "allow_once" || decision === "allow_session"
      || decision === "allow_workspace" || decision === "allow_global" || decision === "deny_once"
      || decision === "deny_session") ? decision : undefined,
  }
}
