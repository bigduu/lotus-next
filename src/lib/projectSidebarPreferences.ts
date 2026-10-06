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

export const PROJECT_SECTIONS_STORAGE_KEY = "lotus.sidebar.project-sections.v1"
export const LEGACY_PROJECT_SECTION_ID = "legacy"
export const SIDEBAR_SESSION_DRAG_TYPE = "application/x-lotus-sidebar-session"

export type ProjectSidebarSection = { id: string; name: string }
type ProjectSectionPreference = {
  sections: ProjectSidebarSection[]
  sessionSections: Record<string, string | null>
  hiddenLegacy: boolean
}
export type ProjectSectionPreferences = {
  version: 1
  projects: Record<string, ProjectSectionPreference>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const validId = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= 256
const validName = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && [...value.trim()].length <= 80 && !Array.from(value).some((character) => { const code = character.codePointAt(0)!; return code < 32 || code === 127 })
const emptyPreferences = (): ProjectSectionPreferences => ({ version: 1, projects: {} })
const emptyProjectPreference = (): ProjectSectionPreference => ({ sections: [], sessionSections: {}, hiddenLegacy: false })
const getProjectPreference = (preferences: ProjectSectionPreferences, projectId: string) =>
  Object.hasOwn(preferences.projects, projectId) ? preferences.projects[projectId]! : emptyProjectPreference()

/** Device-only organization. Invalid entries must not suppress the server's legacy section. */
export function readProjectSectionPreferences(): ProjectSectionPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROJECT_SECTIONS_STORAGE_KEY) ?? "null")
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.projects)) return emptyPreferences()
    const projects: ProjectSectionPreferences["projects"] = {}
    for (const [projectId, entry] of Object.entries(value.projects)) {
      if (!validId(projectId) || !isRecord(entry) || !Array.isArray(entry.sections) || !isRecord(entry.sessionSections)) continue
      const sections: ProjectSidebarSection[] = []
      for (const section of entry.sections) {
        if (!isRecord(section) || !validId(section.id) || section.id === LEGACY_PROJECT_SECTION_ID || !validName(section.name)) continue
        const id = section.id
        const name = section.name.trim()
        if (sections.some((existing) => existing.id === id || existing.name.toLocaleLowerCase() === name.toLocaleLowerCase())) continue
        sections.push({ id, name })
      }
      const allowedIds = new Set([LEGACY_PROJECT_SECTION_ID, ...sections.map((section) => section.id)])
      const sessionSections = Object.fromEntries(Object.entries(entry.sessionSections).filter(([sessionId, sectionId]) =>
        validId(sessionId) && (sectionId === null || (typeof sectionId === "string" && allowedIds.has(sectionId))),
      )) as Record<string, string | null>
      const validShape = entry.sections.length === sections.length && Object.keys(entry.sessionSections).length === Object.keys(sessionSections).length
      Object.defineProperty(projects, projectId, {
        value: { sections, sessionSections, hiddenLegacy: entry.hiddenLegacy === true && validShape }, enumerable: true, configurable: true, writable: true,
      })
    }
    return { version: 1, projects }
  } catch {
    return emptyPreferences()
  }
}

export function writeProjectSectionPreferences(preferences: ProjectSectionPreferences): void {
  try {
    localStorage.setItem(PROJECT_SECTIONS_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // The Sidebar retains the same preferences in React state for this session.
  }
}

export function getProjectSections(preferences: ProjectSectionPreferences, projectId: string, legacyName?: string | null): ProjectSidebarSection[] {
  const preference = getProjectPreference(preferences, projectId)
  const legacy = legacyName?.trim()
  return legacy && !preference.hiddenLegacy
    ? [{ id: LEGACY_PROJECT_SECTION_ID, name: legacy }, ...preference.sections]
    : preference.sections
}

export function getSessionSection(preferences: ProjectSectionPreferences, projectId: string, sessionId: string, legacyName?: string | null): string | null {
  const preference = getProjectPreference(preferences, projectId)
  const sections = getProjectSections(preferences, projectId, legacyName)
  if (Object.hasOwn(preference.sessionSections, sessionId)) {
    const selected = preference.sessionSections[sessionId]
    return selected && sections.some((section) => section.id === selected) ? selected : null
  }
  // A project-level section name defines an empty bucket, not membership.
  // Only an explicit user move assigns a session, including newly created ones.
  return null
}

const withProjectPreference = (preferences: ProjectSectionPreferences, projectId: string, project: ProjectSectionPreference): ProjectSectionPreferences =>
  ({ version: 1, projects: { ...preferences.projects, [projectId]: project } })

export function createProjectSection(preferences: ProjectSectionPreferences, projectId: string, name: string, legacyName?: string | null, sectionId?: string): ProjectSectionPreferences {
  if (!validId(projectId) || !validName(name)) return preferences
  const trimmed = name.trim()
  if (getProjectSections(preferences, projectId, legacyName).some((section) => section.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return preferences
  const previous = getProjectPreference(preferences, projectId)
  const id = sectionId ?? `section:${crypto.randomUUID()}`
  if (!validId(id) || id === LEGACY_PROJECT_SECTION_ID || previous.sections.some((section) => section.id === id)) return preferences
  return withProjectPreference(preferences, projectId, { ...previous, sections: [...previous.sections, { id, name: trimmed }] })
}

export function removeProjectSection(preferences: ProjectSectionPreferences, projectId: string, sectionId: string, legacyName?: string | null): ProjectSectionPreferences {
  if (!getProjectSections(preferences, projectId, legacyName).some((section) => section.id === sectionId)) return preferences
  const previous = getProjectPreference(preferences, projectId)
  return withProjectPreference(preferences, projectId, {
    ...previous,
    sections: previous.sections.filter((section) => section.id !== sectionId),
    hiddenLegacy: previous.hiddenLegacy || sectionId === LEGACY_PROJECT_SECTION_ID,
    sessionSections: Object.fromEntries(Object.entries(previous.sessionSections).map(([sessionId, selected]) => [sessionId, selected === sectionId ? null : selected])),
  })
}

export function setSessionSection(preferences: ProjectSectionPreferences, projectId: string, sessionId: string, sectionId: string | null, legacyName?: string | null): ProjectSectionPreferences {
  if (!validId(projectId) || !validId(sessionId) || (sectionId !== null && !getProjectSections(preferences, projectId, legacyName).some((section) => section.id === sectionId))) return preferences
  const previous = getProjectPreference(preferences, projectId)
  return withProjectPreference(preferences, projectId, { ...previous, sessionSections: { ...previous.sessionSections, [sessionId]: sectionId } })
}
