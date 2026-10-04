import { uiText } from "@shared/i18n/ui"
/**
 * Quick-start task templates for the home dashboard (ported from lotus's
 * EmptyTaskLauncher catalog). Picking one prefills the composer and stashes
 * task-mode instructions that useChat.send composes after the selected/default
 * system-prompt preset on the FIRST message of the new session (sessions are
 * created implicitly on send in lotus-next, unlike lotus's client-side
 * addChat).
 *
 * System prompts stay English (they address the model); UI labels follow the
 * app's hardcoded-Chinese convention.
 */

export type TemplateCategory = "development" | "debugging" | "analysis" | "documentation" | "operations"

export type TaskTemplate = {
  id: string
  /** lucide icon name key, resolved in the dashboard component. */
  icon: string
  title: string
  description: string
  prefill: string
  taskPrompt?: string
  category: TemplateCategory
}

export const CATEGORY_ORDER: TemplateCategory[] = [
  "development",
  "debugging",
  "analysis",
  "documentation",
  "operations",
]

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  get development() { return uiText("development_9ec42862") },
  get debugging() { return uiText("troubleshooting_0793d14f") },
  get analysis() { return uiText("analysis_2af437d3") },
  get documentation() { return uiText("documentation_2687ccdb") },
  get operations() { return uiText("operations_2805edf2") },
}

const CODE_REVIEW = [
  "For this session, operate in code review mode.",
  "Review code changes with emphasis on correctness, regressions, security, maintainability, tests, and rollout risk.",
  "Prefer concise findings with severity, rationale, and actionable fixes.",
  "Ask for missing scope or repository context before making strong assumptions.",
].join(" ")

const BUG_INVESTIGATION = [
  "For this session, operate in bug investigation mode.",
  "Help diagnose issues by analyzing code, logs, stack traces, and runtime behavior.",
  "Trace root causes methodically, suggest targeted fixes, and flag related risks.",
  "Ask for reproduction steps or error messages if not provided.",
].join(" ")

const IMPLEMENT_FEATURE = [
  "For this session, operate in feature implementation mode.",
  "Help plan and implement new features step by step, following existing code conventions.",
  "Consider edge cases, testing strategies, and backward compatibility.",
  "Propose an implementation plan before writing code when scope is large.",
].join(" ")

const ARCHITECTURE_REVIEW = [
  "For this session, operate in architecture analysis mode.",
  "Analyze the repository structure, key abstractions, data flow, and module boundaries.",
  "Identify architectural patterns, coupling hotspots, and potential improvements.",
  "Use diagrams to illustrate relationships when helpful.",
].join(" ")

const EXPLAIN_ERROR = [
  "For this session, operate in error explanation mode.",
  "Help users understand error messages, stack traces, and unexpected behavior.",
  "Explain the root cause clearly, suggest fixes, and provide prevention tips.",
  "Keep explanations accessible even for less experienced developers.",
].join(" ")

const COMPARE_FILES = [
  "For this session, operate in file comparison mode.",
  "Compare the given files or code sections, highlighting key differences and their implications.",
  "Focus on functional changes, potential regressions, and design trade-offs.",
].join(" ")

const REFACTOR = [
  "For this session, operate in refactoring advisor mode.",
  "Suggest targeted refactoring improvements for readability, maintainability, and performance.",
  "Respect existing code style, propose incremental changes, and explain the rationale.",
  "Flag any risks introduced by the refactoring.",
].join(" ")

const RELEASE_NOTES = [
  "For this session, operate in release notes generation mode.",
  "Generate clear, well-structured release notes from git history and code changes.",
  "Categorize changes (features, fixes, improvements, breaking changes).",
  "Write for both technical and non-technical readers.",
].join(" ")

const SUMMARIZE_WORK = [
  "For this session, operate in work summary mode.",
  "Help summarize recent work activity for standups, weeklies, or status reports.",
  "Pull key accomplishments, blockers, and next steps from session history or code changes.",
  "Keep output concise and actionable.",
].join(" ")

const WRITE_DOCS = [
  "For this session, operate in documentation writer mode.",
  "Help create or improve technical documentation from code and project context.",
  "Follow good documentation practices: clear structure, examples, and consistent terminology.",
  "Produce Markdown-formatted output by default.",
].join(" ")

const SCHEDULED_TASK = [
  "For this session, operate in scheduled task setup mode.",
  "Help the user create a recurring scheduled task in Bamboo.",
  "Clarify the task goal, frequency, workspace, and expected output before proceeding.",
  "Guide the user through configuration and confirm before saving.",
].join(" ")

const SESSION_REVIEW = [
  "For this session, operate in session review mode.",
  "Help inspect and analyze past session history for patterns, insights, or issues.",
  "Summarize key decisions, outcomes, and areas that may need follow-up.",
].join(" ")

const TOKEN_USAGE = [
  "For this session, operate in context diagnostics mode.",
  "Help analyze token usage, prompt bloat, context growth, truncation, and compression behavior.",
  "Quantify likely causes when possible and recommend concrete, prioritized fixes.",
  "Keep the output practical for engineers improving prompt and session efficiency.",
].join(" ")

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "blank",
    icon: "plus",
    get title() { return uiText("blank_session_b3d1db15") },
    get description() { return uiText("start_from_scratch_with_the_default_assistant_and_an_em_6ccce42b") },
    prefill: "",
    category: "development",
  },
  {
    id: "codeReview",
    icon: "code",
    get title() { return uiText("code_review_fd5dc005") },
    get description() { return uiText("start_a_review_session_with_editable_review_instruction_88b1cc9f") },
    prefill:
      "Review the relevant code changes in this workspace or repository. Start with the overall scope, then list risks, notable diffs, and the most important fixes.",
    taskPrompt: CODE_REVIEW,
    category: "development",
  },
  {
    id: "implementFeature",
    icon: "wrench",
    get title() { return uiText("implement_a_feature_1ddbacbb") },
    get description() { return uiText("plan_and_implement_a_feature_step_by_step_following_exi_13d8115d") },
    prefill:
      "Help me implement a new feature in this workspace. Start by understanding the codebase structure, then propose an implementation plan before writing code.",
    taskPrompt: IMPLEMENT_FEATURE,
    category: "development",
  },
  {
    id: "refactor",
    icon: "gitCompare",
    get title() { return uiText("refactoring_advice_2b476822") },
    get description() { return uiText("get_focused_advice_on_code_quality_and_maintainability_651b3684") },
    prefill:
      "Suggest refactoring improvements for the code in this workspace. Focus on readability, maintainability, and performance. Propose incremental changes with clear rationale.",
    taskPrompt: REFACTOR,
    category: "development",
  },
  {
    id: "bugInvestigation",
    icon: "bug",
    get title() { return uiText("investigate_a_bug_af57765b") },
    get description() { return uiText("find_the_root_cause_using_code_logs_and_runtime_behavio_7ce9e8b4") },
    prefill:
      "Help me investigate a bug. I'll describe the symptoms and share relevant code or logs. Trace the root cause and suggest targeted fixes.",
    taskPrompt: BUG_INVESTIGATION,
    category: "debugging",
  },
  {
    id: "explainError",
    icon: "helpCircle",
    get title() { return uiText("explain_an_error_28d73930") },
    get description() { return uiText("understand_an_error_message_or_stack_trace_dcea6ce4") },
    prefill:
      "Help me understand the following error. Explain the root cause, suggest fixes, and share prevention tips.",
    taskPrompt: EXPLAIN_ERROR,
    category: "debugging",
  },
  {
    id: "tokenUsage",
    icon: "barChart",
    get title() { return uiText("token_usage_diagnostics_2c9aeec8") },
    get description() { return uiText("diagnose_context_growth_truncation_risks_and_token_budg_fb7d69ae") },
    prefill:
      "Help me investigate token usage, context growth, and truncation risk for this session or workflow. Summarize the likely drivers and recommend concrete next fixes.",
    taskPrompt: TOKEN_USAGE,
    category: "debugging",
  },
  {
    id: "architectureReview",
    icon: "network",
    get title() { return uiText("explore_repository_architecture_362772ad") },
    get description() { return uiText("analyze_repository_structure_modules_and_architecture_p_c4144c28") },
    prefill:
      "Analyze the architecture of this repository. Map the key modules, data flow, abstractions, and dependency patterns. Identify strengths and potential improvements.",
    taskPrompt: ARCHITECTURE_REVIEW,
    category: "analysis",
  },
  {
    id: "compareFiles",
    icon: "fileSearch",
    get title() { return uiText("compare_files_ab62da9c") },
    get description() { return uiText("compare_files_or_code_snippets_to_understand_difference_4f4b61db") },
    prefill:
      "Compare the following files or code sections. Highlight key differences, their implications, and any potential risks.",
    taskPrompt: COMPARE_FILES,
    category: "analysis",
  },
  {
    id: "releaseNotes",
    icon: "fileText",
    get title() { return uiText("generate_release_notes_3f4a4bc9") },
    get description() { return uiText("create_structured_release_notes_from_git_history_and_co_4ce6bd0b") },
    prefill:
      "Generate release notes for the latest changes in this workspace. Categorize into features, fixes, improvements, and breaking changes.",
    taskPrompt: RELEASE_NOTES,
    category: "documentation",
  },
  {
    id: "summarizeWork",
    icon: "bookOpen",
    get title() { return uiText("summarize_work_0aefa71c") },
    get description() { return uiText("prepare_a_work_summary_for_a_stand_up_or_weekly_update_139cd09f") },
    prefill:
      "Help me summarize my recent work for a status update. Pull key accomplishments, blockers, and next steps.",
    taskPrompt: SUMMARIZE_WORK,
    category: "documentation",
  },
  {
    id: "writeDocs",
    icon: "fileText",
    get title() { return uiText("write_documentation_af1b8189") },
    get description() { return uiText("create_or_improve_technical_documentation_using_project_9f5371fb") },
    prefill:
      "Help me write technical documentation for this project. Analyze the code and produce clear, well-structured Markdown documentation.",
    taskPrompt: WRITE_DOCS,
    category: "documentation",
  },
  {
    id: "createSchedule",
    icon: "clock",
    get title() { return uiText("create_a_scheduled_task_edd706c3") },
    get description() { return uiText("set_up_a_recurring_task_to_run_automatically_on_a_sched_9ec9d769") },
    prefill:
      "Help me set up a recurring scheduled task. I'll describe what I want it to do, and you guide me through the configuration.",
    taskPrompt: SCHEDULED_TASK,
    category: "operations",
  },
  {
    id: "sessionReview",
    icon: "search",
    get title() { return uiText("review_session_history_e0929a0e") },
    get description() { return uiText("inspect_past_sessions_for_patterns_and_follow_up_items_ea45ad91") },
    prefill:
      "Help me review my recent session history. Summarize key decisions, outcomes, and areas that need follow-up.",
    taskPrompt: SESSION_REVIEW,
    category: "operations",
  },
]

// ── First-send system-prompt handoff ────────────────────────────────────
// A picked template's task prompt is handed to useChat.send when it creates a
// new session. The send path composes it after the prompt-preset chip instead
// of replacing that base prompt. Sending is async, so reading cannot clear the
// task prompt before the backend acknowledges the request.

export type PendingTemplatePromptSnapshot = Readonly<{
  prompt: string
  revision: number
}>

let pendingTemplatePrompt: PendingTemplatePromptSnapshot | null = null
let pendingTemplatePromptRevision = 0

export const setPendingTemplatePrompt = (prompt: string | null): void => {
  if (prompt === null) {
    pendingTemplatePrompt = null
    return
  }

  pendingTemplatePromptRevision += 1
  pendingTemplatePrompt = Object.freeze({
    prompt,
    revision: pendingTemplatePromptRevision,
  })
}

/** Read the current handoff without consuming it before the send is acknowledged. */
export const peekPendingTemplatePrompt = (): PendingTemplatePromptSnapshot | null =>
  pendingTemplatePrompt

/**
 * Clear only the exact handoff that an acknowledged send used.
 *
 * The revision comparison prevents a late acknowledgement from clearing a
 * template that the user selected while the earlier request was in flight,
 * including when they selected the same template again.
 */
export const acknowledgePendingTemplatePrompt = (
  snapshot: PendingTemplatePromptSnapshot,
): boolean => {
  if (
    pendingTemplatePrompt?.revision !== snapshot.revision ||
    pendingTemplatePrompt.prompt !== snapshot.prompt
  ) {
    return false
  }

  pendingTemplatePrompt = null
  return true
}
