import { describe, expect, it } from "vitest"
import type { TaskItem } from "@services/chat/AgentService"
import { layoutSessionTaskDag } from "./sessionTaskDagLayout"

function task(id: string, depends_on: string[] = []): TaskItem {
  return { id, description: id, status: "pending", depends_on, notes: "" }
}

describe("session task DAG layout", () => {
  it("places both branches before a join, including when the join is listed first", () => {
    const layout = layoutSessionTaskDag([
      task("report", ["bamboo", "lotus"]), task("lotus", ["prepare"]), task("prepare"), task("bamboo", ["prepare"]),
    ])!
    const prepare = layout.positions.get("prepare")!
    const bamboo = layout.positions.get("bamboo")!
    const lotus = layout.positions.get("lotus")!
    const report = layout.positions.get("report")!
    expect(prepare.x).toBeLessThan(bamboo.x)
    expect(bamboo.x).toBe(lotus.x)
    expect(bamboo.y).not.toBe(lotus.y)
    expect(lotus.x).toBeLessThan(report.x)
    expect(layout.edges).toHaveLength(4)
  })

  it("draws one edge per known dependency and keeps a step with a missing predecessor", () => {
    const layout = layoutSessionTaskDag([task("read"), task("report", ["read", "read", "outside"])])!
    expect(layout.edges).toMatchObject([{ from: "read", to: "report" }])
    expect(layout.positions.has("report")).toBe(true)
  })

  it("routes a dependency that crosses columns above the intermediate node", () => {
    const layout = layoutSessionTaskDag([task("start"), task("read", ["start"]), task("report", ["start", "read"])])!
    const direct = layout.edges.find(({ from, to }) => from === "start" && to === "report")!
    const lane = direct.path.match(/ V (\d+) H /)
    expect(lane).not.toBeNull()
    expect(Number(lane![1])).toBeLessThan(layout.positions.get("read")!.y)
  })

  it("connects parent-only steps in the same column without duplicating prerequisite arrows", () => {
    const layout = layoutSessionTaskDag([
      task("review"), { ...task("check"), parent_id: "review" },
      { ...task("report", ["review"]), parent_id: "review" },
      task("independent"), { ...task("missing-parent"), parent_id: "outside" },
    ])!
    expect(layout.edges).toMatchObject([
      { from: "review", to: "report", kind: "dependency" },
      { from: "review", to: "check", kind: "step" },
    ])
    expect(layout.positions.get("check")?.x).toBe(layout.positions.get("review")?.x)
    expect(layout.positions.get("report")!.x).toBeGreaterThan(layout.positions.get("review")!.x)
  })

  it("keeps drawing prerequisite arrows when parent grouping points back across columns", () => {
    const layout = layoutSessionTaskDag([
      { ...task("draft"), parent_id: "report" },
      task("review", ["draft"]), task("report", ["review"]),
    ])!
    expect(layout.edges).toMatchObject([
      { from: "draft", to: "review", kind: "dependency" },
      { from: "review", to: "report", kind: "dependency" },
      { from: "report", to: "draft", kind: "step" },
    ])
    expect(layout.positions.get("draft")!.x).toBeLessThan(layout.positions.get("report")!.x)
  })

  it("leaves cyclic dependencies for the task-list fallback", () => {
    expect(layoutSessionTaskDag([task("read", ["report"]), task("report", ["read"])])).toBeNull()
  })
})
