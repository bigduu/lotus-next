import { describe, expect, it } from "vitest"
import { expectedTicketScopeCancellation, unexpectedFailedRequests } from "../e2e/support/failedRequestPolicy.ts"

const origin = "http://127.0.0.1:32768"
const scopeAbort = `GET ${origin}/api/v1/tickets/scope net::ERR_ABORTED`

describe("deliberate ticket scope cancellation", () => {
  it("admits the aborted scope read on the observed origin", () => {
    expect(expectedTicketScopeCancellation(scopeAbort, origin)).toBe(true)
    expect(unexpectedFailedRequests([scopeAbort], origin)).toEqual([])
  })

  it("removes only the admitted cancellation from a mixed recording", () => {
    const transportFailure = `GET ${origin}/assets/app.js net::ERR_FAILED`
    const otherPath = `GET ${origin}/api/v1/tickets/other net::ERR_ABORTED`
    expect(
      unexpectedFailedRequests([scopeAbort, transportFailure, otherPath, scopeAbort], origin),
    ).toEqual([transportFailure, otherPath])
  })

  it("never mutates the failures the observation recorded", () => {
    const recorded = [scopeAbort, `GET ${origin}/api/v1/tickets/other net::ERR_ABORTED`]
    expect(unexpectedFailedRequests(recorded, origin)).toEqual([recorded[1]])
    expect(recorded).toEqual([scopeAbort, `GET ${origin}/api/v1/tickets/other net::ERR_ABORTED`])
  })
})

describe("every other failed request still fails the page contract", () => {
  it.each([
    ["other path", `GET ${origin}/api/v1/tickets/other net::ERR_ABORTED`],
    ["path extension", `GET ${origin}/api/v1/tickets/scope/extra net::ERR_ABORTED`],
    ["path prefix", `GET ${origin}/api/v1/tickets/scopeX net::ERR_ABORTED`],
    ["other method", `POST ${origin}/api/v1/tickets/scope net::ERR_ABORTED`],
    ["read method", `HEAD ${origin}/api/v1/tickets/scope net::ERR_ABORTED`],
    ["transport reset", `GET ${origin}/api/v1/tickets/scope net::ERR_CONNECTION_RESET`],
    ["transport failure", `GET ${origin}/api/v1/tickets/scope net::ERR_FAILED`],
    ["network change", `GET ${origin}/api/v1/tickets/scope net::ERR_NETWORK_CHANGED`],
    ["unknown failure", `GET ${origin}/api/v1/tickets/scope unknown failure`],
    ["other origin", `GET http://127.0.0.1:32769/api/v1/tickets/scope net::ERR_ABORTED`],
    ["https origin", `GET https://localhost/api/v1/tickets/scope net::ERR_ABORTED`],
    ["unrelated transport failure", `GET ${origin}/assets/app.js net::ERR_FAILED`],
    ["other read cancellation", `GET ${origin}/api/v1/browser/sessions/selected/dom net::ERR_ABORTED`],
  ])("keeps a %s failure", (_case, failure) => {
    expect(expectedTicketScopeCancellation(failure, origin)).toBe(false)
    expect(unexpectedFailedRequests([failure], origin)).toEqual([failure])
  })

  it("still fails when a recording holds only unadmitted failures", () => {
    const failures = [
      `GET ${origin}/api/v1/tickets/other net::ERR_ABORTED`,
      `POST ${origin}/api/v1/tickets/scope net::ERR_ABORTED`,
      `GET ${origin}/api/v1/tickets/scope net::ERR_CONNECTION_RESET`,
      `GET ${origin}/assets/app.js net::ERR_FAILED`,
    ]
    const remaining = unexpectedFailedRequests(failures, origin)
    expect(remaining).toEqual(failures)
    expect(remaining).not.toEqual([])
  })
})

describe("observed CI failure from run 42058955677 attempt 1", () => {
  const observed = ["GET http://127.0.0.1:32768/api/v1/tickets/scope net::ERR_ABORTED"]

  it("fails the unfixed contract and passes only through the narrow admission", () => {
    // The original assertion compared the recording itself against [].
    expect(observed).not.toEqual([])
    expect(unexpectedFailedRequests(observed, "http://127.0.0.1:32768")).toEqual([])
  })

  it("does not admit the same recording observed on another origin", () => {
    expect(unexpectedFailedRequests(observed, "http://127.0.0.1:32769")).toEqual(observed)
  })
})
