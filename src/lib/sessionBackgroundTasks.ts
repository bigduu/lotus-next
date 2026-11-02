import type { Message } from "@shared/types/chatMessages"
import { isBusyPhase, type SessionExecutionState } from "@shared/store/appStore/slices/executionStateSlice"

/**
 * Background shell (bash) launch detection for sidebar activity indicators.
 *
 * A background tool launch returns an ordinary `tool_result` whose JSON body is
 * `{ bash_id, command, status: "running", cwd, environment }`. `command` is the
 * load-bearing discriminator: BashOutput (`{bash_id, status, exit_code, ...}`)
 * and BashInput (`{bash_id, status, bytes_written, ...}`) results also report
 * `status: "running"` while the shell is alive but carry no `command`, so
 * reading/feeding a live shell must not count as a second launch. This mirrors
 * the tool-card parser in `components/chat/ToolCalls.tsx`.
 *
 * Terminal outcomes arrive separately (the `backgroundBash` store slice, keyed
 * by `bash_id`), so a shell counts as running until its id is recorded there.
 */
export function parseBackgroundBashLaunch(resultText: unknown): string | null {
  if (typeof resultText !== "string" || resultText.length === 0) return null
  let value: unknown
  try {
    value = JSON.parse(resultText)
  } catch {
    return null
  }
  if (!value || typeof value !== "object") return null
  const row = value as { bash_id?: unknown; command?: unknown; status?: unknown }
  if (
    typeof row.bash_id !== "string" ||
    row.bash_id.length === 0 ||
    row.status !== "running" ||
    typeof row.command !== "string" ||
    row.command.length === 0
  ) {
    return null
  }
  return row.bash_id
}

/** Every `bash_id` a transcript launched in the background, in message order. */
function collectBackgroundBashIds(messages: readonly Message[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if ((message as { type?: string }).type !== "tool_result") continue
    const result = (message as { result?: { result?: unknown } }).result
    const bashId = parseBackgroundBashLaunch(result?.result)
    if (bashId !== null && !ids.includes(bashId)) ids.push(bashId)
  }
  return ids
}

/**
 * Scan results are cached per message array identity: a sidebar row re-renders
 * far more often than a transcript changes, and each transcript can carry
 * thousands of tool results.
 */
const launchedIdsCache = new WeakMap<readonly Message[], string[]>()

/**
 * True when a background shell launched by this transcript has no recorded
 * terminal outcome. `backgroundBash` is the store slice keyed by `bash_id`; a
 * missing entry means the shell is still running. Read reactively by the
 * caller, so a terminal outcome flips this without rescanning messages.
 */
export function sessionHasRunningBackgroundBash(
  messages: readonly Message[] | undefined,
  backgroundBash: Readonly<Record<string, unknown>>,
): boolean {
  if (!messages || messages.length === 0) return false
  let ids = launchedIdsCache.get(messages)
  if (ids === undefined) {
    ids = collectBackgroundBashIds(messages)
    launchedIdsCache.set(messages, ids)
  }
  return ids.some((bashId) => backgroundBash[bashId] === undefined)
}

/**
 * The sidebar's "still working" predicate. A session counts as running while
 * any work is in flight — the main execution, a live sub-agent, or a background
 * shell, which outlives the main execution and therefore keeps running after
 * the backend reports `is_running: false`.
 *
 * A background launch only counts while this client holds an execution entry
 * for the session, i.e. it actually engaged with it. `BashCompleted` is
 * replayable session state, so an engaged session is re-delivered the outcome
 * as soon as it is observed again (see `selectShouldObserve`, which keeps such
 * sessions observed on purpose). Without that fence a transcript launch with no
 * recorded outcome would pulse forever for a session this client never watches.
 */
export function sessionHasLiveWork(
  session: {
    isRunning?: boolean
    messages?: readonly Message[]
    /**
     * The server's own count of this session's executing children
     * (`SessionSummary.running_child_count`). A delegating Root yields, so
     * `isRunning` can read `false` mid-hand-off; unlike the local `execution`
     * entry this is also known for a session this client never opened.
     */
    runningChildCount?: number
  },
  execution: SessionExecutionState | undefined,
  backgroundBash: Readonly<Record<string, unknown>>,
): boolean {
  if (session.isRunning) return true
  if ((session.runningChildCount ?? 0) > 0) return true
  if (execution) {
    if (isBusyPhase(execution.phase)) return true
    if (execution.children.runningCount > 0) return true
    return sessionHasRunningBackgroundBash(session.messages, backgroundBash)
  }
  return false
}
