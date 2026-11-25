const localFeatureChunkUrl = /(?:^|\/)(?:Settings(?:Page)?|WorkflowRunsContent|runDiagnostic|RunDiagnosticsDialogContent|BrowserPane|TicketWorkPanel|ConversationClearDialogContent|SupervisorManagedSessions|ProjectWorkBoard|renderMermaid|recoverMermaidRenderer)-[A-Za-z0-9_-]+\.(?:js|css)(?:[?#]|$)/
let pendingLocalImports = 0
const localImportErrors = new WeakSet<Error>()

/**
 * Let an identified feature import rejection reach its local recovery.
 * PDF and other unclaimed imports still use the shared whole-page recovery.
 */
export const isLocalFeaturePreloadError = (payload: unknown): boolean => {
  if (payload instanceof Error) {
    return [payload.message, ...(payload.stack?.split("\n") ?? [])].some((line) =>
      localFeatureChunkUrl.test(line.trim()),
    )
  }
  return typeof payload === "string" && localFeatureChunkUrl.test(payload)
}

export async function importWithLocalPreloadRecovery<T>(load: () => Promise<T>): Promise<T> {
  pendingLocalImports++
  try {
    return await load()
  } catch (error) {
    if (error instanceof Error) localImportErrors.add(error)
    throw error
  } finally {
    pendingLocalImports--
  }
}

export const mayBeLocalWebKitPreloadError = (payload: unknown): payload is Error =>
  pendingLocalImports > 0 && payload instanceof Error && payload.message === "Importing a module script failed."

export const isClaimedLocalPreloadError = (payload: Error): boolean => localImportErrors.has(payload)
