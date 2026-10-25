/** Draft-only configuration: null means keep the selected workspace. */
export interface NewChatWorktreeSelection {
  repository: string
  root: string
  name: string
  branch: string
}

/** Pure configuration UI; all filesystem mutations belong to first-send preparation. */
export interface NewChatWorktreeControlProps {
  projectId: string | null
  workspacePath: string | null | undefined
  value: NewChatWorktreeSelection | null
  onChange: (value: NewChatWorktreeSelection | null) => void
  disabled?: boolean
  preparedPath?: string | null
  error?: string | null
}
