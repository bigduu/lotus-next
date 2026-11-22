import type { TaskItem } from "@services/chat/AgentService"

export const taskNodeWidth = 188
export const taskNodeHeight = 80
const columnGap = 42
const columnSpacing = taskNodeWidth + columnGap
const rowSpacing = taskNodeHeight + 14
const laneSpacing = 14
const padding = 12

export function layoutSessionTaskDag(items: readonly TaskItem[]) {
  const dependencyCounts = new Map(items.map((item) => [item.id, 0]))
  const dependents = new Map<string, string[]>()
  const edges: { from: string; to: string }[] = []

  for (const item of items) {
    for (const from of new Set(item.depends_on)) {
      if (!dependencyCounts.has(from)) continue
      edges.push({ from, to: item.id })
      dependencyCounts.set(item.id, dependencyCounts.get(item.id)! + 1)
      const targets = dependents.get(from) ?? []
      targets.push(item.id)
      dependents.set(from, targets)
    }
  }

  const ready = items.filter((item) => dependencyCounts.get(item.id) === 0).map((item) => item.id)
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
  if (ready.length !== items.length) return null

  const rankOf = (id: string) => ranks.get(id) ?? 0
  // Route dependencies that skip columns above the node boxes.
  const longEdges = edges.filter(({ from, to }) => rankOf(to) > rankOf(from) + 1)
  longEdges.sort((left, right) => rankOf(left.from) - rankOf(right.from))
  const laneEnds: number[] = []
  const edgeLanes = new Map<(typeof edges)[number], number>()
  for (const edge of longEdges) {
    const reusable = laneEnds.findIndex((end) => end < rankOf(edge.from))
    const lane = reusable === -1 ? laneEnds.length : reusable
    laneEnds[lane] = rankOf(edge.to)
    edgeLanes.set(edge, lane)
  }
  const lanesHeight = laneEnds.length * laneSpacing

  const columns: string[][] = []
  for (const item of items) {
    const rank = rankOf(item.id)
    const column = columns[rank] ??= []
    column.push(item.id)
  }
  const maxRows = columns.reduce((largest, column) => Math.max(largest, column.length), 1)
  const positions = new Map<string, { x: number; y: number }>()
  columns.forEach((column, rank) => {
    column.forEach((id, row) => positions.set(id, {
      x: padding + rank * columnSpacing,
      y: padding + lanesHeight + (row + (maxRows - column.length) / 2) * rowSpacing,
    }))
  })

  return {
    positions,
    edges: edges.map((edge) => {
      const start = positions.get(edge.from)!
      const end = positions.get(edge.to)!
      const x1 = start.x + taskNodeWidth
      const x2 = end.x - 3
      const lane = edgeLanes.get(edge)
      if (lane !== undefined) {
        const y1 = start.y + taskNodeHeight / 4
        const y2 = end.y + taskNodeHeight / 4
        const laneY = padding + lane * laneSpacing
        const startGutter = x1 + columnGap / 2
        const endGutter = end.x - columnGap / 2
        return { ...edge, path: `M ${x1} ${y1} H ${startGutter} V ${laneY} H ${endGutter} V ${y2} H ${x2}` }
      }
      const y1 = start.y + taskNodeHeight / 2
      const y2 = end.y + taskNodeHeight / 2
      const bend = (x1 + x2) / 2
      return { ...edge, path: `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}` }
    }),
    width: padding * 2 + taskNodeWidth + Math.max(0, columns.length - 1) * columnSpacing,
    height: padding * 2 + lanesHeight + taskNodeHeight + (maxRows - 1) * rowSpacing,
  }
}
