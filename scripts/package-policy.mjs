const metadataFiles = new Set(["README.md", "package.json"])
const licenseMetadata = /^(?:copying|licen[cs]e|unlicense)(?:\.(?:md|rst|txt))?$/i

const forbiddenDirectoryNames = new Set([
  ".cache",
  ".git",
  ".vite",
  "__fixtures__",
  "__mocks__",
  "__snapshots__",
  "__tests__",
  "cache",
  "coverage",
  "e2e",
  "examples",
  "fixture",
  "fixtures",
  "mock",
  "mocks",
  "node_modules",
  "playwright",
  "snapshot",
  "snapshots",
  "source",
  "sources",
  "spec",
  "specs",
  "src",
  "stories",
  "storybook",
  "temp",
  "test",
  "tests",
  "tmp",
])

// `dist/` is a static frontend package. Fail closed on file types: a new
// production format must be reviewed and added here instead of silently
// allowing source, source maps, archives, credentials, or tool artifacts.
const allowedRuntimeExtension =
  /\.(?:avif|css|gif|html?|ico|jpe?g|js|json|mjs|mp3|mp4|ogg|png|svg|txt|wasm|webmanifest|webp|woff2?|xml)$/i
const forbiddenFileNames = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
])
const sensitiveFileToken =
  /(?:^|[._-])(?:api[_-]?key|credentials?|private[_-]?key|secrets?|signing[_-]?key|tokens?)(?:[._-]|$)/i
const cacheFileToken = /(?:^|[._-])cache(?:[._-]|$)/i
const developmentFileToken =
  /(?:^|[._-])(?:fixture|mock|spec|stories|story|test)(?:[._-]|$)/i
const localConfigName =
  /^(?:(?:dev|development|local)(?:\.config)?|config\.(?:dev|development|local))(?:\.|$)/i
const toolConfigStem =
  /^(?:babel|eslint|jest|oxlint|postcss|prettier|tailwind|tsconfig|vite|vitest)(?:\.|$)/i
const environmentFile = /^\.(?:env(?:\..*)?|npmrc|netrc)$/i

export const isUnexpectedPackagePath = (file) => {
  if (metadataFiles.has(file) || licenseMetadata.test(file)) return false

  const normalized = file.replaceAll("\\", "/")
  if (!normalized.startsWith("dist/") || normalized.includes("../")) return true

  const runtimePath = normalized.slice("dist/".length)
  const segments = runtimePath.split("/")
  if (
    segments.some(
      (segment) =>
        segment.startsWith(".") ||
        forbiddenDirectoryNames.has(segment.toLowerCase()) ||
        cacheFileToken.test(segment) ||
        sensitiveFileToken.test(segment),
    )
  ) {
    return true
  }

  const basename = segments.at(-1) ?? ""
  return (
    environmentFile.test(basename) ||
    forbiddenFileNames.has(basename.toLowerCase()) ||
    cacheFileToken.test(basename) ||
    developmentFileToken.test(basename) ||
    sensitiveFileToken.test(basename) ||
    localConfigName.test(basename) ||
    toolConfigStem.test(basename) ||
    !allowedRuntimeExtension.test(basename)
  )
}

export const findUnexpectedPackagePaths = (paths) =>
  paths.filter((file) => isUnexpectedPackagePath(file))
