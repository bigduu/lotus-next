import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"))
const packageLock = JSON.parse(readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8"))

const safeFloors = {
  mermaid: "11.16.1",
  dompurify: "3.4.13",
  postcss: "8.5.23",
  nanoid: "3.3.18",
}

function versionParts(version) {
  return version.split(".").map((part) => Number.parseInt(part, 10))
}

function isAtLeast(version, floor) {
  const actual = versionParts(version)
  const minimum = versionParts(floor)
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index]
  }
  return true
}

describe("audited dependency floors", () => {
  it("keeps only Mermaid direct and resolves every vulnerable package at a safe floor", () => {
    expect(packageJson.dependencies.mermaid).toBe("^11.16.1")
    expect(packageJson.dependencies).not.toHaveProperty("dompurify")
    expect(packageJson.dependencies).not.toHaveProperty("postcss")
    expect(packageJson.dependencies).not.toHaveProperty("nanoid")
    expect(packageJson).not.toHaveProperty("overrides")

    for (const [name, floor] of Object.entries(safeFloors)) {
      const suffix = `/node_modules/${name}`
      const resolvedInstances = Object.entries(packageLock.packages)
        .filter(([path]) => path === `node_modules/${name}` || path.endsWith(suffix))
        .map(([path, entry]) => ({ path, version: entry.version }))

      expect(resolvedInstances, `${name} must remain in the resolved graph`).not.toHaveLength(0)
      for (const { path, version } of resolvedInstances) {
        expect(version, `${path} must resolve a version`).toBeTypeOf("string")
        expect(isAtLeast(version, floor), `${path} resolves ${version}, below ${floor}`).toBe(true)
      }
    }
  })
})
