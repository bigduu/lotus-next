import { expect, it } from "vitest"
import type { BrowserProfileMode } from "./types"
import { browserProfileOpenRequest, readBrowserProfileReport } from "./profileMode"

it.each([
  ["shared", true, { kind: "reported", mode: "shared", storageShared: true }],
  ["clean", false, { kind: "reported", mode: "clean", storageShared: false }],
] as const)("accepts the coherent %s mode report", (mode, shared, expected) => {
  expect(readBrowserProfileReport({ profile_mode: mode, storage_shared: shared })).toEqual(expected)
})

it.each([undefined, null, {}])("does not infer shared mode from an absent report: %j", (state) => {
  expect(readBrowserProfileReport(state)).toEqual({ kind: "unreported" })
})

it.each([
  { profile_mode: "shared", storage_shared: false },
  { profile_mode: "clean", storage_shared: true },
  { profile_mode: "shared" },
  { profile_mode: "clean" },
  { storage_shared: true },
  { storage_shared: false },
  { profile_mode: "unknown", storage_shared: true },
  { profile_mode: "SHARED", storage_shared: true },
  { profile_mode: null, storage_shared: false },
  { profile_mode: "clean", storage_shared: "false" },
  { profile_mode: "shared", storage_shared: 1 },
])("rejects incoherent or partial mode metadata: %j", (state) => {
  expect(readBrowserProfileReport(state)).toEqual({ kind: "invalid" })
})

it.each(["shared", "clean"] as const)("serializes only the explicit %s mode", (mode) => {
  expect(browserProfileOpenRequest(mode)).toEqual({ profile_mode: mode })
  expect(Object.keys(browserProfileOpenRequest(mode))).toEqual(["profile_mode"])
})

it.each([undefined, null, "", "SHARED", "private", { profile_mode: "clean", path: "/not-an-api-field" }])(
  "refuses invalid open input before a transport can receive it: %j",
  (mode) => {
    expect(() => browserProfileOpenRequest(mode as BrowserProfileMode)).toThrow(TypeError)
  },
)
