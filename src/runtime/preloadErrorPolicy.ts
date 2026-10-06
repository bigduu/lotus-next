const settingsChunkUrl = /(?:^|\/)Settings-[A-Za-z0-9_-]+\.(?:js|css)(?:[?#]|$)/

/**
 * Settings has a local Suspense/ErrorBoundary recovery surface. Let its import
 * rejection reach that boundary instead of applying the legacy whole-page
 * preload reload policy used by renderer/PDF chunks.
 */
export const isSettingsFeaturePreloadError = (payload: unknown): boolean => {
  if (payload instanceof Error) {
    return [payload.message, ...(payload.stack?.split("\n") ?? [])].some((line) =>
      settingsChunkUrl.test(line.trim()),
    )
  }
  return typeof payload === "string" && settingsChunkUrl.test(payload)
}
