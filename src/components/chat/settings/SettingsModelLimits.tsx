import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionModelLimits } from "./system/SectionModelLimits"
import { useSystemConfig } from "./system/useSystemConfig"

/** Standalone model-limit settings tab. */
export function SettingsModelLimits() {
  const { config, loading, loadError, reload, saveSection } = useSystemConfig()

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (loadError) {
    return (
      <section className="space-y-2 rounded-lg border p-3">
        <p className="text-xs text-destructive">模型限额加载失败:{loadError}</p>
        <Button size="sm" variant="secondary" onClick={() => void reload()}>
          重试
        </Button>
      </section>
    )
  }

  return config ? <SectionModelLimits config={config} saveSection={saveSection} /> : null
}
