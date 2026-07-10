import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useExperienceModeStore } from "@shared/store/experienceModeStore"
import { useSystemConfig } from "./system/useSystemConfig"
import { SectionProxy } from "./system/SectionProxy"
import { SectionMemory } from "./system/SectionMemory"
import { SectionSubagents } from "./system/SectionSubagents"
import { SectionTools } from "./system/SectionTools"
import { SectionAccessPassword } from "./system/SectionAccessPassword"
import { SectionModelLimits } from "./system/SectionModelLimits"
import { SectionHooks } from "./system/SectionHooks"
import { SectionSessions } from "./system/SectionSessions"
import { SectionApp } from "./system/SectionApp"

/**
 * 系统 — consolidates lotus's system/config/app/sessions tabs:
 * 代理 / 记忆 / 子代理 / 工具 / 访问密码 / 模型限额 / Hooks / 会话维护 / 应用.
 *
 * The tab itself stays visible in 简洁 (simple) experience mode, but only the
 * sections that were simple-mode tabs in legacy lotus remain: 模型限额
 * (model-limits) and 应用 (app). The rest came from legacy's advanced-only
 * config/hooks/sessions tabs and hide until 高级 mode.
 */
export function SettingsSystem() {
  const { config, loading, loadError, reload, saveSection } = useSystemConfig()
  const isAdvanced = useExperienceModeStore((s) => s.isAdvanced)

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : loadError ? (
        <section className="space-y-2 rounded-lg border p-3">
          <p className="text-xs text-destructive">配置加载失败:{loadError}</p>
          <Button size="sm" variant="secondary" onClick={() => void reload()}>
            重试
          </Button>
        </section>
      ) : config ? (
        <>
          {isAdvanced ? (
            <>
              <SectionProxy config={config} saveSection={saveSection} />
              <SectionMemory config={config} saveSection={saveSection} />
              <SectionSubagents config={config} saveSection={saveSection} />
              <SectionTools config={config} saveSection={saveSection} />
            </>
          ) : null}
          <SectionModelLimits config={config} saveSection={saveSection} />
          {isAdvanced ? <SectionHooks config={config} saveSection={saveSection} /> : null}
        </>
      ) : null}

      {isAdvanced ? (
        <>
          <SectionAccessPassword saveSection={saveSection} configReady={!!config} />
          <SectionSessions />
        </>
      ) : null}
      <SectionApp />
    </div>
  )
}
