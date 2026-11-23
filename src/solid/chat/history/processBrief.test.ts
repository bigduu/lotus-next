import { describe, expect, it } from "vitest"
import { extractProcessBrief } from "./processBrief"

describe("extractProcessBrief", () => {
  it("uses the newest real sentence and removes Markdown formatting", () => {
    expect(extractProcessBrief("## Earlier plan\n- **Check** the API.\n> Latest [connection](https://example.test) is `ready`."))
      .toBe("Latest connection is ready.")
    expect(extractProcessBrief("第一步检查配置。现在验证**最终结果**，保留 `run_tests`。"))
      .toBe("现在验证最终结果，保留 run_tests。")
    expect(extractProcessBrief("Earlier step. Verify `Map<T>` now."))
      .toBe("Verify Map<T> now.")
    expect(extractProcessBrief("Previous result.\n  > - [x] **Latest result** is confirmed."))
      .toBe("Latest result is confirmed.")
  })

  it("keeps a Unicode-safe 72-character limit and marks a truncated excerpt", () => {
    const result = extractProcessBrief(`Earlier. ${"检".repeat(74)}🔍`)
    expect(Array.from(result)).toHaveLength(72)
    expect(result).toBe(`${"检".repeat(71)}…`)
    expect(extractProcessBrief("检查🔍验证🔎完成", 5)).toBe("检查🔍验…")
    expect(extractProcessBrief(`${"🔍".repeat(1024)}x`)).toBe(`${"🔍".repeat(71)}…`)
    expect(extractProcessBrief(" \n---\n```\n``` ")).toBe("")
    expect(extractProcessBrief(undefined)).toBe("")
  })
})
