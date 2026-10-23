export const progressSessionId = "all-surface-session"
export const progressAt = "2026-10-19T04:00:00Z"
// Optional fields frozen at Bamboo 5af6c01c. The consumer does
// not branch on them, count episodes, infer pending, or authorize continuation.
export const exhaustedMarker = "observation_progress_exhausted"
// Exact unchanged-file notice text from the frozen producer source, not a model capture.
export const unfinishedSummary = "The task is not confirmed complete. Repeated file observations did not establish new progress. The finite diagnostic budget is exhausted, so this execution stopped before another recovery-model request or tool round. Review the collected evidence or provide new Human direction."
// Synthetic opaque value used by the producer's own persistence fixture too;
// it is not a captured provider packet and carries no decision authority.
export const exhaustedNoticeMetadata = { runtime_kind: exhaustedMarker, source: "runtime", progress_feedback: "[runtime_progress_feedback_v1]\n{}" }
export const legacyQuestionId = "fixture-persisted-progress-question"
export const legacyQuestionText = "The run is paused. Continue, stop, or provide a different approach."
export const legacyProgressQuestion = () => ({
  has_pending_question: true as const, interaction_kind: "clarification" as const, question: legacyQuestionText,
  options: ["Continue", "Stop"], allow_custom: true, tool_call_id: legacyQuestionId, permission_request: null,
})
export const currentPermission = () => ({
  has_pending_question: true as const, interaction_kind: "permission" as const,
  question: "Canonical permission generation 2: the guarded operation still needs your decision.",
  options: ["Continue", "Stop", "Always allow"], allow_custom: true, tool_call_id: "fixture-permission-2",
  permission_request: { session_id: progressSessionId, request_id: "fixture-permission-2",
    request_generation: "opaque-generation-2", policy_revision: 9, tool_name: "Bash",
    permission_type: "execute_command", resource: "echo fixture-only",
    operation_summary: "A harmless fixture standing in for a gated tool; no tool is executed",
    allowed_decisions: ["allow_once", "deny_once"] },
})
// Self-contained raw fixture shape keeps browser/Node tests independent of
// application-only TS path aliases. Hook mocks and the real mapper verify its
// structural compatibility with the production consumer types.
type ConsumerHistory = { id: string; role: "user" | "assistant" | "tool"; content: string; created_at: string;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string; tool_success?: boolean; metadata?: Record<string, unknown> }[]
export const pairedProgressHistory = (rounds = 6): ConsumerHistory => [
  { id: "progress-user", role: "user", content: "Inspect the fixture and report what is unfinished", created_at: progressAt },
  ...Array.from({ length: rounds }, (_, index): ConsumerHistory => [
    { id: `assistant-read-${index}`, role: "assistant", content: "", created_at: progressAt,
      tool_calls: [{ id: `read-${index}`, type: "function", function: { name: "Read", arguments: '{"file_path":"/fixture/evidence.txt"}' } }] },
    { id: `result-read-${index}`, role: "tool", content: "Unchanged fixture evidence", tool_call_id: `read-${index}`,
      tool_success: true, created_at: progressAt },
  ]).flat(),
]
export const exhaustedHistory = (): ConsumerHistory => [
  ...pairedProgressHistory(),
  { id: "runtime-unfinished-summary", role: "assistant", content: unfinishedSummary,
    metadata: { ...exhaustedNoticeMetadata }, created_at: progressAt },
]
