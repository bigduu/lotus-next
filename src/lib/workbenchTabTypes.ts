export type RightWorkbenchTab = "inspector" | "review" | "browser" | "subagents" | "work" | "task-dag" | "side-chat"
export type WorkbenchToolTab = Exclude<RightWorkbenchTab, "browser">
