import type { TaskItem } from "@services/chat/AgentService"

export const taskNodeWidth = 188
export const taskNodeHeight = 80
const rowGap = 42
const rowSpacing = taskNodeHeight + rowGap
const columnSpacing = taskNodeWidth + 14
const laneSpacing = 14
const padding = 12

type TaskEdge = { from: string; to: string; kind: "dependency" | "step" }

function rankTasks(ids: readonly string[], edges: readonly TaskEdge[]) {
  const dependencyCounts = new Map(ids.map((id) => [id, 0]))
  const dependents = new Map<string, string[]>()

  for (const { from, to } of edges) {
    dependencyCounts.set(to, dependencyCounts.get(to)! + 1)
    const targets = dependents.get(from) ?? []
    targets.push(to)
    dependents.set(from, targets)
  }

  const ready = ids.filter((id) => dependencyCounts.get(id) === 0)
  const ranks = new Map<string, number>()
  for (let index = 0; index < ready.length; index += 1) {
    const id = ready[index]!
    const nextRank = (ranks.get(id) ?? 0) + 1
    for (const target of dependents.get(id) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, nextRank))
      const remaining = dependencyCounts.get(target)! - 1
      dependencyCounts.set(target, remaining)
      if (remaining === 0) ready.push(target)
    }
  }
  return ready.length === ids.length ? ranks : null
}

export function layoutSessionTaskDag(items: readonly TaskItem[]) {
  const ids = items.map((item) => item.id)
  const prerequisites = new Map(items.map((item) => [item.id, new Set(item.depends_on)]))
  const dependencies: TaskEdge[] = []
  const steps: TaskEdge[] = []
  for (const { id, parent_id: parentId } of items) {
    const required = prerequisites.get(id)!
    for (const from of required) {
      if (prerequisites.has(from)) dependencies.push({ from, to: id, kind: "dependency" })
    }
    // One line is enough when the same pair already has a dependency.
    if (parentId && parentId !== id && prerequisites.has(parentId) &&
      !required.has(parentId) && !prerequisites.get(parentId)?.has(id)) {
      steps.push({ from: parentId, to: id, kind: "step" })
    }
  }
  const edges = [...dependencies, ...steps]
  // Put steps under their parents when grouping agrees with the dependency
  // order. If the two conflict, real prerequisites determine the rows.
  const ranks = rankTasks(ids, edges) ?? (steps.length ? rankTasks(ids, dependencies) : null)
  if (!ranks) return null

  const rankOf = (id: string) => ranks.get(id) ?? 0
  const firstRank = ({ from, to }: TaskEdge) => Math.min(rankOf(from), rankOf(to))
  const lastRank = ({ from, to }: TaskEdge) => Math.max(rankOf(from), rankOf(to))
  // Route lines that skip rows down the left side of the node boxes.
  const longEdges = edges.filter((edge) => lastRank(edge) > firstRank(edge) + 1)
  longEdges.sort((left, right) => firstRank(left) - firstRank(right))
  const laneEnds: number[] = []
  const edgeLanes = new Map<(typeof edges)[number], number>()
  for (const edge of longEdges) {
    const reusable = laneEnds.findIndex((end) => end < firstRank(edge))
    const lane = reusable === -1 ? laneEnds.length : reusable
    laneEnds[lane] = lastRank(edge)
    edgeLanes.set(edge, lane)
  }
  const lanesWidth = laneEnds.length * laneSpacing

  const rows: string[][] = []
  for (const id of ids) {
    const row = rows[rankOf(id)] ??= []
    row.push(id)
  }
  const maxColumns = rows.reduce((largest, row) => Math.max(largest, row.length), 1)
  const positions = new Map<string, { x: number; y: number }>()
  rows.forEach((row, rank) => {
    row.forEach((id, column) => positions.set(id, {
      x: padding + lanesWidth + (column + (maxColumns - row.length) / 2) * columnSpacing,
      y: padding + rank * rowSpacing,
    }))
  })

  return {
    positions,
    edges: edges.map((edge) => {
      // A step line has no arrow. Orient its path downward even when
      // prerequisites place the parent on a later row.
      const downward = rankOf(edge.from) <= rankOf(edge.to)
      const start = positions.get(downward ? edge.from : edge.to)!
      const end = positions.get(downward ? edge.to : edge.from)!
      if (start.y === end.y) {
        const gutter = start.y - padding / 2
        const x1 = start.x + taskNodeWidth * 0.75
        const x2 = end.x + taskNodeWidth * 0.75
        return { ...edge, path: `M ${x1} ${start.y} V ${gutter} H ${x2} V ${end.y}` }
      }
      const y1 = start.y + taskNodeHeight
      const y2 = end.y - (edge.kind === "dependency" ? 3 : 0)
      const lane = edgeLanes.get(edge)
      const port = taskNodeWidth * (edge.kind === "step" ? 0.75 : lane === undefined ? 0.5 : 0.25)
      const x1 = start.x + port
      const x2 = end.x + port
      if (lane !== undefined) {
        const laneX = padding + lane * laneSpacing
        const startGutter = y1 + rowGap / 2
        const endGutter = end.y - rowGap / 2
        return { ...edge, path: `M ${x1} ${y1} V ${startGutter} H ${laneX} V ${endGutter} H ${x2} V ${y2}` }
      }
      const bend = (y1 + y2) / 2
      return { ...edge, path: `M ${x1} ${y1} C ${x1} ${bend}, ${x2} ${bend}, ${x2} ${y2}` }
    }),
    width: padding * 2 + lanesWidth + taskNodeWidth + (maxColumns - 1) * columnSpacing,
    height: padding * 2 + taskNodeHeight + Math.max(0, rows.length - 1) * rowSpacing,
  }
}
