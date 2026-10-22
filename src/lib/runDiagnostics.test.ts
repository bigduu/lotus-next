import { afterEach, describe, expect, it, vi } from "vitest"
import { createRunDiagnostics, downloadRunDiagnostics } from "./runDiagnostics"
import type { RunDiagnosticsSubject } from "./runDiagnosticId"
import { diagnosticFixture, diagnosticFixtureError } from "@services/chat/runDiagnostic.testFixtures"

const sid = "11111111-1111-4111-8111-111111111111"
const id = "9ab6cd70-bc43-4fed-9f10-50c2873fa287"
const now = "2026-10-22T16:00:00.000Z"
const subject: RunDiagnosticsSubject = { sessionId: sid, localOperationId: 7, failureKind: "generation-failed", diagnosticId: id }
const runtime = { artifact: { version: "2026.10.19", revision: "a".repeat(40) }, host: { kind: "browser" } }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe("local allowlist diagnostic report", () => {
  it("exports finite v2 fields without raw error/failure text and never resurrects live data on a missing refresh", () => {
    const current = { ...subject, errorBinding:diagnosticFixtureError, liveDiagnostic:diagnosticFixture(sid) }
    const live = createRunDiagnostics(current,sid,runtime,now)!
    expect(live.diagnostic).toMatchObject({ source:"live_event",attempt:1,attempt_limit:4,retry_stop_reason:"time_budget_exhausted",canonical_status:"not_checked" })
    expect(JSON.stringify(live)).not.toContain("initial response headers timed out")
    expect(JSON.stringify(live)).not.toContain("Try again later")
    expect(createRunDiagnostics(current,sid,runtime,now,{ diagnostic:null,source:"canonical_read",canonicalStatus:"not_provided" })!.diagnostic.failure_stage).toBeNull()
    expect(createRunDiagnostics(current,sid,runtime,now,{ diagnostic:diagnosticFixture(sid),source:"canonical_read",canonicalStatus:"changed" })).toBeNull()
  })

  it("excludes raw errors and all ambient/private fields rather than redacting a dump", () => {
    const sensitive = "PRIVATE_SENTINEL_do_not_export"
    const report = createRunDiagnostics({
      ...subject, messages: [sensitive], error: sensitive, rawError: "Diagnostic ID: " + id + ". " + sensitive,
      token: sensitive, tools: [{ arguments: sensitive, result: sensitive }], screenshot: sensitive,
    } as RunDiagnosticsSubject, sid, {
      ...runtime, auth: { cookie: sensitive, apiKey: sensitive }, endpoints: { origin: "https://" + sensitive },
      config: { workspace_path: sensitive }, headers: { authorization: sensitive }, console: sensitive,
      artifact: { ...runtime.artifact, key: sensitive }, host: { ...runtime.host, pid: 123, path: sensitive },
    }, now)!
    expect(JSON.stringify(report)).not.toContain(sensitive)
    expect(report).toMatchObject({
      schema_version: 1, collected_at: now,
      frontend: { package_name: "@bigduu/lotus-next", version: "2026.10.19", source_revision: "a".repeat(40), host_kind: "browser" },
      context: { session_id: sid, client_operation_id: 7, failure_kind: "generation-failed" },
      diagnostic: { diagnostic_id: id, source: "legacy_terminal_error_marker", structured_details: "not_provided",
        backend_run_id: null, failure_stage: null, attempt: null, attempt_limit: null, retry_stop_reason: null },
    })
    expect([report, report.frontend, report.context, report.diagnostic].every(Object.isFrozen)).toBe(true)
  })
  it("rejects a different current session, including a new composer", () => {
    expect(createRunDiagnostics(subject, "22222222-2222-4222-8222-222222222222", runtime, now)).toBeNull()
    expect(createRunDiagnostics(subject, null, runtime, now)).toBeNull()
  })
  it("keeps absent or secret-shaped primitive values unavailable", () => {
    const report = createRunDiagnostics({ ...subject, sessionId: "sk-private", localOperationId: Number.NaN, diagnosticId: "Bearer private" },
      "sk-private", { artifact: { version: "https://private.invalid/key", revision: "Bearer private" }, host: { kind: "secret-host" } }, "not-a-date")!
    expect(report.context.session_id).toBeNull(); expect(report.context.client_operation_id).toBeNull()
    expect(report.frontend).toMatchObject({ version: null, source_revision: null, host_kind: null })
    expect(report.diagnostic.diagnostic_id).toBeNull(); expect(report.collected_at).toBeNull()
    expect(JSON.stringify(report)).not.toMatch(/sk-private|Bearer|private.invalid|secret-host/)
  })
  it("supports canonical Supervisor and unconfirmed new-session failures without a fictitious ID", () => {
    expect(createRunDiagnostics({ ...subject, sessionId: "bamboo-default-supervisor" }, "bamboo-default-supervisor", runtime)!.context.session_id).toBe("bamboo-default-supervisor")
    const report = createRunDiagnostics({ sessionId: null, localOperationId: 1, failureKind: "submission-unconfirmed", diagnosticId: null }, null, runtime, now)!
    expect(report.context).toMatchObject({ session_id: null, client_operation_id: 1, failure_kind: "submission-unconfirmed" })
    expect(report.diagnostic.source).toBe("not_provided")
    expect(report.diagnostic.attempt_limit).toBeNull()
  })
  it("does not export unsupported failure kinds or unsafe numeric context", () => {
    expect(createRunDiagnostics({ ...subject, failureKind: "retry-now" } as unknown as RunDiagnosticsSubject, sid, runtime)).toBeNull()
    expect(createRunDiagnostics({ ...subject, localOperationId: Number.MAX_SAFE_INTEGER + 1 }, sid, runtime)!.context.client_operation_id).toBeNull()
  })
  it("requests one local JSON download with a fixed safe filename and releases the object URL", () => {
    vi.useFakeTimers()
    const create = vi.fn<(object: Blob | MediaSource) => string>(() => "blob:synthetic-local"), revoke = vi.fn()
    const BaseURL = URL
    vi.stubGlobal("URL", class extends BaseURL { static createObjectURL = create; static revokeObjectURL = revoke })
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch)
    let file = ""
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { file = this.download })
    downloadRunDiagnostics(createRunDiagnostics(subject, sid, runtime, now)!)
    expect(create).toHaveBeenCalledTimes(1)
    const blob = create.mock.calls[0]![0]
    expect(blob).toBeInstanceOf(Blob)
    expect((blob as Blob).type).toBe("application/json")
    expect(file).toBe("bamboo-run-diagnostics.json"); expect(click).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a[download="bamboo-run-diagnostics.json"]')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    vi.runAllTimers(); expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-local")
  })
})
