/**
 * Quick-start task templates for the home dashboard (ported from lotus's
 * EmptyTaskLauncher catalog). Picking one prefills the composer and stashes a
 * base system prompt that useChat.send consumes on the FIRST message of the
 * new session (sessions are created implicitly on send in lotus-next, unlike
 * lotus's client-side addChat).
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
  baseSystemPrompt?: string
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
  development: "开发",
  debugging: "排障",
  analysis: "分析",
  documentation: "文档",
  operations: "运维",
}

const CODE_REVIEW = [
  "You are Bodhi operating in code review mode.",
  "Review code changes with emphasis on correctness, regressions, security, maintainability, tests, and rollout risk.",
  "Prefer concise findings with severity, rationale, and actionable fixes.",
  "Ask for missing scope or repository context before making strong assumptions.",
].join(" ")

const BUG_INVESTIGATION = [
  "You are Bodhi operating in bug investigation mode.",
  "Help diagnose issues by analyzing code, logs, stack traces, and runtime behavior.",
  "Trace root causes methodically, suggest targeted fixes, and flag related risks.",
  "Ask for reproduction steps or error messages if not provided.",
].join(" ")

const IMPLEMENT_FEATURE = [
  "You are Bodhi operating in feature implementation mode.",
  "Help plan and implement new features step by step, following existing code conventions.",
  "Consider edge cases, testing strategies, and backward compatibility.",
  "Propose an implementation plan before writing code when scope is large.",
].join(" ")

const ARCHITECTURE_REVIEW = [
  "You are Bodhi operating in architecture analysis mode.",
  "Analyze the repository structure, key abstractions, data flow, and module boundaries.",
  "Identify architectural patterns, coupling hotspots, and potential improvements.",
  "Use diagrams to illustrate relationships when helpful.",
].join(" ")

const EXPLAIN_ERROR = [
  "You are Bodhi operating in error explanation mode.",
  "Help users understand error messages, stack traces, and unexpected behavior.",
  "Explain the root cause clearly, suggest fixes, and provide prevention tips.",
  "Keep explanations accessible even for less experienced developers.",
].join(" ")

const COMPARE_FILES = [
  "You are Bodhi operating in file comparison mode.",
  "Compare the given files or code sections, highlighting key differences and their implications.",
  "Focus on functional changes, potential regressions, and design trade-offs.",
].join(" ")

const REFACTOR = [
  "You are Bodhi operating in refactoring advisor mode.",
  "Suggest targeted refactoring improvements for readability, maintainability, and performance.",
  "Respect existing code style, propose incremental changes, and explain the rationale.",
  "Flag any risks introduced by the refactoring.",
].join(" ")

const RELEASE_NOTES = [
  "You are Bodhi operating in release notes generation mode.",
  "Generate clear, well-structured release notes from git history and code changes.",
  "Categorize changes (features, fixes, improvements, breaking changes).",
  "Write for both technical and non-technical readers.",
].join(" ")

const SUMMARIZE_WORK = [
  "You are Bodhi operating in work summary mode.",
  "Help summarize recent work activity for standups, weeklies, or status reports.",
  "Pull key accomplishments, blockers, and next steps from session history or code changes.",
  "Keep output concise and actionable.",
].join(" ")

const WRITE_DOCS = [
  "You are Bodhi operating in documentation writer mode.",
  "Help create or improve technical documentation from code and project context.",
  "Follow good documentation practices: clear structure, examples, and consistent terminology.",
  "Produce Markdown-formatted output by default.",
].join(" ")

const SCHEDULED_TASK = [
  "You are Bodhi operating in scheduled task setup mode.",
  "Help the user create a recurring scheduled task in Bamboo.",
  "Clarify the task goal, frequency, workspace, and expected output before proceeding.",
  "Guide the user through configuration and confirm before saving.",
].join(" ")

const SESSION_REVIEW = [
  "You are Bodhi operating in session review mode.",
  "Help inspect and analyze past session history for patterns, insights, or issues.",
  "Summarize key decisions, outcomes, and areas that may need follow-up.",
].join(" ")

const TOKEN_USAGE = [
  "You are Bodhi operating in context diagnostics mode.",
  "Help analyze token usage, prompt bloat, context growth, truncation, and compression behavior.",
  "Quantify likely causes when possible and recommend concrete, prioritized fixes.",
  "Keep the output practical for engineers improving prompt and session efficiency.",
].join(" ")

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "blank",
    icon: "plus",
    title: "空白会话",
    description: "从零开始,默认助手 + 空白输入框。",
    prefill: "",
    category: "development",
  },
  {
    id: "codeReview",
    icon: "code",
    title: "代码评审",
    description: "以评审视角开一个会话,附带可编辑的评审说明。",
    prefill:
      "Review the relevant code changes in this workspace or repository. Start with the overall scope, then list risks, notable diffs, and the most important fixes.",
    baseSystemPrompt: CODE_REVIEW,
    category: "development",
  },
  {
    id: "implementFeature",
    icon: "wrench",
    title: "实现功能",
    description: "按现有代码约定,一步步规划并实现新功能。",
    prefill:
      "Help me implement a new feature in this workspace. Start by understanding the codebase structure, then propose an implementation plan before writing code.",
    baseSystemPrompt: IMPLEMENT_FEATURE,
    category: "development",
  },
  {
    id: "refactor",
    icon: "gitCompare",
    title: "重构建议",
    description: "获取针对性的代码质量与可维护性改进建议。",
    prefill:
      "Suggest refactoring improvements for the code in this workspace. Focus on readability, maintainability, and performance. Propose incremental changes with clear rationale.",
    baseSystemPrompt: REFACTOR,
    category: "development",
  },
  {
    id: "bugInvestigation",
    icon: "bug",
    title: "Bug 调查",
    description: "通过代码、日志与运行时行为定位问题根因。",
    prefill:
      "Help me investigate a bug. I'll describe the symptoms and share relevant code or logs. Trace the root cause and suggest targeted fixes.",
    baseSystemPrompt: BUG_INVESTIGATION,
    category: "debugging",
  },
  {
    id: "explainError",
    icon: "helpCircle",
    title: "解释报错",
    description: "从错误信息或堆栈理解哪里出了问题。",
    prefill:
      "Help me understand the following error. Explain the root cause, suggest fixes, and share prevention tips.",
    baseSystemPrompt: EXPLAIN_ERROR,
    category: "debugging",
  },
  {
    id: "tokenUsage",
    icon: "barChart",
    title: "Token 用量诊断",
    description: "诊断上下文增长、截断风险与 token 预算压力。",
    prefill:
      "Help me investigate token usage, context growth, and truncation risk for this session or workflow. Summarize the likely drivers and recommend concrete next fixes.",
    baseSystemPrompt: TOKEN_USAGE,
    category: "debugging",
  },
  {
    id: "architectureReview",
    icon: "network",
    title: "读仓库架构",
    description: "分析仓库结构、模块与架构模式。",
    prefill:
      "Analyze the architecture of this repository. Map the key modules, data flow, abstractions, and dependency patterns. Identify strengths and potential improvements.",
    baseSystemPrompt: ARCHITECTURE_REVIEW,
    category: "analysis",
  },
  {
    id: "compareFiles",
    icon: "fileSearch",
    title: "对比文件",
    description: "对比文件或代码片段,理解差异与影响。",
    prefill:
      "Compare the following files or code sections. Highlight key differences, their implications, and any potential risks.",
    baseSystemPrompt: COMPARE_FILES,
    category: "analysis",
  },
  {
    id: "releaseNotes",
    icon: "fileText",
    title: "生成发布说明",
    description: "从 git 历史与代码变更生成结构化发布说明。",
    prefill:
      "Generate release notes for the latest changes in this workspace. Categorize into features, fixes, improvements, and breaking changes.",
    baseSystemPrompt: RELEASE_NOTES,
    category: "documentation",
  },
  {
    id: "summarizeWork",
    icon: "bookOpen",
    title: "总结工作",
    description: "为站会或周报生成工作总结。",
    prefill:
      "Help me summarize my recent work for a status update. Pull key accomplishments, blockers, and next steps.",
    baseSystemPrompt: SUMMARIZE_WORK,
    category: "documentation",
  },
  {
    id: "writeDocs",
    icon: "fileText",
    title: "写文档",
    description: "基于代码与项目上下文创建或完善技术文档。",
    prefill:
      "Help me write technical documentation for this project. Analyze the code and produce clear, well-structured Markdown documentation.",
    baseSystemPrompt: WRITE_DOCS,
    category: "documentation",
  },
  {
    id: "createSchedule",
    icon: "clock",
    title: "创建定时任务",
    description: "设置一个按计划自动运行的循环任务。",
    prefill:
      "Help me set up a recurring scheduled task. I'll describe what I want it to do, and you guide me through the configuration.",
    baseSystemPrompt: SCHEDULED_TASK,
    category: "operations",
  },
  {
    id: "sessionReview",
    icon: "search",
    title: "回顾会话历史",
    description: "检视过往会话,发现模式与需要跟进的点。",
    prefill:
      "Help me review my recent session history. Summarize key decisions, outcomes, and areas that need follow-up.",
    baseSystemPrompt: SESSION_REVIEW,
    category: "operations",
  },
]

// ── First-send system-prompt handoff ────────────────────────────────────
// A picked template's base prompt is consumed exactly once by useChat.send
// when it creates the new session (it outranks the preset chip for that one
// send). Cleared when the user picks another template or sends.

let pendingTemplatePrompt: string | null = null

export const setPendingTemplatePrompt = (prompt: string | null): void => {
  pendingTemplatePrompt = prompt
}

export const consumePendingTemplatePrompt = (): string | null => {
  const value = pendingTemplatePrompt
  pendingTemplatePrompt = null
  return value
}
