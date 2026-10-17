/** Capture before cancelling DnD: its focused preview can disappear on cancel. */
export function captureWorkbenchFocusReturn(
  target: HTMLElement | null,
  scope: string | null,
  currentScope: () => string | null,
): () => HTMLElement | null {
  const handleId = target?.closest<HTMLElement>("[data-workbench-tab-handle]")?.dataset.workbenchTabHandle
  return () => {
    if (currentScope() !== scope) return null
    if (!handleId) return target
    const handles = document.querySelectorAll<HTMLElement>("#right-workbench [data-workbench-tab-handle]")
    return [...handles].find((handle) => handle.dataset.workbenchTabHandle === handleId && !handle.closest("[inert]")) ?? null
  }
}
