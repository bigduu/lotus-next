import { Container, Monitor, Server } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { SessionPlacement } from "@services/chat/AgentService"

/** Pick an icon by deployment kind: local machine, container, or remote host. */
function iconForKind(kind: string) {
  switch (kind) {
    case "ssh":
      return Server
    case "docker":
      return Container
    default:
      return Monitor
  }
}

/**
 * A small badge showing which machine a session's agent runs on — its
 * deployment kind (`local` / `docker` / `ssh`) plus host, e.g.
 * "local · Mac-mini.local" or "ssh · 192.168.1.5". Remote placements are
 * tinted blue to stand out from the local host. Used in the chat header and
 * the sub-agents panel. Renders nothing when placement is absent.
 */
export function MachineTag({
  placement,
  compact,
  className,
}: {
  /** Which machine the session's agent runs on. Renders nothing when absent. */
  placement?: SessionPlacement | null
  /** Compact mode for dense rows: drop the leading "机器" label. */
  compact?: boolean
  className?: string
}) {
  if (!placement || !placement.host) return null

  const { kind, host } = placement
  const isRemote = kind !== "local"
  const Icon = iconForKind(kind)

  return (
    <Badge
      variant="outline"
      title={`运行于 ${kind} · ${host}`}
      className={cn(
        "max-w-full gap-1 font-normal text-muted-foreground",
        isRemote &&
          "border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400",
        className,
      )}
    >
      <Icon />
      {!compact ? <span className="opacity-65">机器</span> : null}
      <span className="truncate">{`${kind} · ${host}`}</span>
    </Badge>
  )
}
