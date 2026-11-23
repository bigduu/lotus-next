import { canonicalizeFileChangePath } from "@/lib/sessionFileChanges"

export type FileChangePathMode = "full" | "relative" | "basename"

const normalizePath = (path: string): string => canonicalizeFileChangePath(path).replace(/\/$/, "")

export function displayFileChangePath(
  filePath: string,
  mode: FileChangePathMode,
  workspace?: string,
): string {
  const normalizedPath = normalizePath(filePath)
  if (mode === "full") return normalizedPath
  if (mode === "basename") {
    return normalizedPath.split("/").filter(Boolean).pop() || normalizedPath
  }

  const normalizedWorkspace = workspace ? normalizePath(workspace) : ""
  if (normalizedWorkspace && normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1)
  }
  return normalizedPath
}
