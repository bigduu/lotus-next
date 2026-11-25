import { runtimeNoticeFromMetadata } from "@/lib/chat/runtimeNotices"
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
  const notice = canPresent && suspended && (activity === undefined || activity === "waiting_bash") && last
    ? runtimeNoticeFromMetadata("metadata" in last ? last.metadata : undefined, "content" in last ? last.content : undefined)
    : null
  const monitoredCommand = notice?.runtimeKind === "background_exec_wait"
  const command = monitoredCommand || (canPresent && activity === "waiting_bash")
  const delegation = canPresent && (activity === "waiting_children"
    || (activity === undefined && (session?.runningChildCount ?? 0) > 0))
  return {
    monitoredCommand,
    execSessionId: monitoredCommand ? notice.execSessionId ?? null : null,
    command,
    yielded: delegation || command,
    delegationHint: delegation && (suspended || activity === "waiting_children") && !command,
  }
}
