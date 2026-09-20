const PINNED_PROJECTS_STORAGE_KEY = "lotus.sidebar.pinned-projects.v1"

const normalizeProjectIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === "string" && !!id.trim()))]
}

export const readPinnedProjectIds = (): Set<string> => {
  try {
    if (typeof localStorage === "undefined") return new Set()
    return new Set(normalizeProjectIds(JSON.parse(localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY) ?? "[]")))
  } catch {
    return new Set()
  }
}

export const writePinnedProjectIds = (projectIds: ReadonlySet<string>): void => {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify([...projectIds]))
  } catch {
    // Sidebar ordering is a best-effort device preference.
  }
}

export { PINNED_PROJECTS_STORAGE_KEY }
