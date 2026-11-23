export type RightWorkbenchTab = "inspector" | "review" | "browser" | "subagents" | "work" | "task-dag"
export type WorkbenchToolTab = Exclude<RightWorkbenchTab, "browser">
