import type { PermissionDecisionChoice, PermissionRequest } from "@services/chat/AgentService"
import { permissionDecisionFor } from "@services/chat/permissionDecision"
import type { AssistantToolResultMessage } from "@shared/types/chatMessages"
import { uiText } from "@shared/i18n/ui"

export type HistoryDecision = NonNullable<NonNullable<AssistantToolResultMessage["permissionHistory"]>["decision"]>

export function permissionActions(request: PermissionRequest, onSelect: (choice: PermissionDecisionChoice) => void) {
  const shell = request.tool_name === "exec_command" || request.tool_name === "Bash"
  const options = [
    ["deny_once", "deny_once_29b8bbf3"],
    ["allow_once", "allow_once_390dd1fc"],
    ["allow_session", shell ? "permission_allow_command_for_session" : "permission_allow_resource_for_session"],
  ] as const
  return options.filter(([choice]) => permissionDecisionFor(request, choice) !== null)
    .map(([choice, label]) => ({ id: choice, label: uiText(label), onSelect: () => onSelect(choice) }))
}

export function permissionReceiptText(decision: HistoryDecision, continued: boolean) {
  if (decision === "allow_session") {
    return uiText(continued ? "permission_session_allow_continued" : "permission_session_allow_recorded")
  }
  if (continued) {
    return uiText(decision.startsWith("deny_") ? "permission_denied_and_continued" : "permission_allowed_and_continued")
  }
  return uiText(decision.startsWith("deny_") ? "permission_deny_recorded" : "permission_allow_recorded")
}
