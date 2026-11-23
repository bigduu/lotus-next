import { describe, expect, it } from "vitest"
import { sidebarDragSource, sidebarDropTarget, validSidebarDrop, validSidebarSource, type SidebarDragState, type SidebarDragPickup } from "./sidebarDrag"
import type { ProjectManifest } from "@services/project"
import type { ChatItem } from "@shared/types/chatMessages"

const state = (): SidebarDragState => {
  const project = { id: "p1", status: "active", revision: 2, section: "Legacy", sidebar: {
    sections: [{ id: "custom", name: "Research" }], session_sections: {}, hidden_legacy: false,
  } } as unknown as ProjectManifest
  return { projects: { p1: project }, busy: new Set(), chats: [{ id: "root", config: { projectId: "p1" } }] as ChatItem[],
    preferences: { version: 1, projects: { p1: { sections: project.sidebar!.sections, sessionSections: {}, hiddenLegacy: false } } } }
}
const session: SidebarDragPickup = { kind: "session", projectId: "p1", id: "root", revision: 2 }

describe("internal sidebar drag authority", () => {
  it("accepts only typed internal source and target data", () => {
    expect(sidebarDragSource({ ...session, revision: "forged" })).toEqual({ kind: "session", projectId: "p1", id: "root" })
    expect(sidebarDragSource({ ...session, kind: "file" })).toBeNull()
    expect(sidebarDragSource({ ...session, projectId: null })).toBeNull()
    expect(sidebarDropTarget({ projectId: "p1", sectionId: null })).toEqual({ projectId: "p1", sectionId: null })
    expect(sidebarDropTarget({ projectId: "p1" })).toBeNull()
  })

  it("moves canonical root sessions only within the same active Project", () => {
    const current = state()
    expect(validSidebarDrop(session, { projectId: "p1", sectionId: "custom" }, current)).toBe(true)
    expect(validSidebarDrop(session, { projectId: "p1", sectionId: null }, current)).toBe(true)
    expect(validSidebarDrop(session, { projectId: "p2", sectionId: "custom" }, current)).toBe(false)
    expect(validSidebarDrop({ ...session, id: "missing" }, { projectId: "p1", sectionId: null }, current)).toBe(false)
    expect(validSidebarDrop(session, { projectId: "p1", sectionId: "missing" }, current)).toBe(false)
    current.chats = [{ id: "root", parentSessionId: "parent", config: { projectId: "p1" } }] as ChatItem[]
    expect(validSidebarSource(session, current)).toBe(false)
    current.chats = [{ id: "root", config: { projectId: "p2" } }] as ChatItem[]
    expect(validSidebarSource(session, current)).toBe(false)
  })

  it("rejects unavailable, archived, busy and unconfirmed snapshots", () => {
    for (const patch of [{ sidebar: undefined }, { status: "archived" }, { revision: 3, confirmed_revision: 2 }]) {
      const current = state()
      current.projects.p1 = { ...current.projects.p1, ...patch } as ProjectManifest
      expect(validSidebarSource(session, current)).toBe(false)
    }
    const current = state()
    current.busy = new Set(["p1"])
    expect(validSidebarSource(session, current)).toBe(false)
  })

  it("rejects a fully confirmed revision that changed after pickup", () => {
    const current = state()
    current.projects.p1 = { ...current.projects.p1, revision: 3 }
    expect(validSidebarSource(session, current)).toBe(true)
    expect(validSidebarDrop(session, { projectId: "p1", sectionId: "custom" }, current)).toBe(false)
  })

  it("allows custom section reordering while keeping the synthetic legacy bucket fixed", () => {
    const current = state()
    expect(validSidebarDrop({ kind: "section", projectId: "p1", id: "custom", revision: 2 }, { projectId: "p1", sectionId: "legacy" }, current)).toBe(true)
    expect(validSidebarSource({ kind: "section", projectId: "p1", id: "legacy" }, current)).toBe(false)
    expect(validSidebarSource({ kind: "section", projectId: "p1", id: "missing" }, current)).toBe(false)
  })
})
