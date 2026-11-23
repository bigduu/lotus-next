import { backgroundExecWaitActive } from "@/components/chat/runtimeNotices"
import { isTerminalRunStatus } from "@shared/store/appStore/slices/executionStateSlice/reducer"
import type { createChat } from "../createChat"

type WorkWaitChat = Pick<ReturnType<typeof createChat>, "currentChat" | "pendingQuestion" | "pendingApproval">

export function transcriptWorkWait(chat: WorkWaitChat) {
  const session = chat.currentChat
  const activity = session?.activity
  const suspended = session?.lastRunStatus === "suspended"
  const canPresent = session?.isRunning !== true && !isTerminalRunStatus(session?.lastRunStatus)
    && !chat.pendingQuestion && !chat.pendingApproval
  const last = session?.messages.at(-1)
  const monitoredCommand = canPresent && suspended && (activity === undefined || activity === "waiting_bash")
    && Boolean(last && backgroundExecWaitActive([{
      metadata: { runtime_kind: "metadata" in last ? last.metadata?.runtime_kind : undefined },
      content: "content" in last ? last.content : undefined,
    }]))
  const command = monitoredCommand || (canPresent && activity === "waiting_bash")
  const delegation = canPresent && (activity === "waiting_children"
    || (activity === undefined && (session?.runningChildCount ?? 0) > 0))
  return {
    monitoredCommand,
    command,
    yielded: delegation || command,
    delegationHint: delegation && (suspended || activity === "waiting_children") && !command,
  }
}
