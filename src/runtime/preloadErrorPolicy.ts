const localFeatureChunkUrl = /(?:^|\/)(?:Settings|WorkflowRunsContent|runDiagnostic|RunDiagnosticsDialogContent)-[A-Za-z0-9_-]+\.(?:js|css)(?:[?#]|$)/

/**
 * These features have a local error boundary or optional-data fallback. Let an
 * exact feature import rejection reach it instead of applying the whole-page
 * preload reload policy used by renderer/PDF chunks.
 */
export const isLocalFeaturePreloadError = (payload: unknown): boolean => {
  if (payload instanceof Error) {
    return [payload.message, ...(payload.stack?.split("\n") ?? [])].some((line) =>
      localFeatureChunkUrl.test(line.trim()),
    )
  }
  return typeof payload === "string" && localFeatureChunkUrl.test(payload)
}
