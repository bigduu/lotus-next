/** Draft-only configuration: null means keep the selected workspace. */
export interface NewChatWorktreeSelection {
  repository: string
  root: string
  name: string
  branch: string
}

export function createWorktreeSelection(repository: string, root: string): NewChatWorktreeSelection {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "")
  const name = `chat-${date}-${crypto.randomUUID().slice(0, 6)}`
  return { repository, root, name, branch: `chat/${name}` }
}

/** Pure configuration UI; all filesystem mutations belong to first-send preparation. */
export interface NewChatWorktreeControlProps {
  projectId: string | null
  workspacePath: string | null | undefined
  value: NewChatWorktreeSelection | null
  onChange: (value: NewChatWorktreeSelection | null) => void
  automatic?: boolean
  disabled?: boolean
  preparedPath?: string | null
  error?: string | null
}
