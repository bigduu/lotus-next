import { readFileSync, readdirSync } from "node:fs"
import ts from "typescript"

// Check executable copy rather than comments or a grep over user-facing data.
const loadCatalog = (path, exportName) => {
  const exports = {}
  const javascript = ts.transpile(readFileSync(path, "utf8"), { module: ts.ModuleKind.CommonJS })
  new Function("exports", javascript)(exports)
  return exports[exportName]
}
const english = loadCatalog("src/shared/i18n/resources/ui-en-US.ts", "uiEnUs")
const chinese = loadCatalog("src/shared/i18n/resources/ui-zh-CN.ts", "uiZhCn")
const problems = []
const placeholders = (value) => [...value.matchAll(/{{\s*([^},]+)[^}]*}}/g)].map((m) => m[1]).sort().join(",")
for (const key of new Set([...Object.keys(english), ...Object.keys(chinese)])) {
  if (typeof english[key] !== "string" || typeof chinese[key] !== "string") problems.push(`Missing locale key: ${key}`)
  else if (placeholders(english[key]) !== placeholders(chinese[key])) problems.push(`Interpolation mismatch: ${key}`)
}
const permittedNativeNames = new Set(["简体中文", "繁體中文", "日本語"])
const walk = (directory) => {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${item.name}`
    if (item.isDirectory()) { if (path !== "src/shared/i18n") walk(path); continue }
    if (!/\.[tj]sx?$/.test(path) || /\.test\.|\/test\//.test(path)) continue
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true)
    const report = (node, message) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
      problems.push(`${path}:${line + 1}: ${message}`)
    }
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "uiText") {
        const key = node.arguments[0]
        if (key && ts.isStringLiteral(key) && !(key.text in english)) report(node, `Unknown UI key ${key.text}`)
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) && /\p{Script=Han}/u.test(node.text)) {
        const text = node.text.trim()
        // Catastrophic pre-React startup deliberately remains dependency-free and bilingual.
        if (path !== "src/main.tsx" && !(path === "src/components/chat/Settings.tsx" && permittedNativeNames.has(text))) report(node, `Unlocalized application literal ${JSON.stringify(text)}`)
      }
      if (ts.isTemplateExpression(node) && /\p{Script=Han}/u.test(node.head.text + node.templateSpans.map((s) => s.literal.text).join(""))) report(node, "Unlocalized template literal")
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
walk("src")
if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1 }
else console.log(`i18n: ${Object.keys(english).length} matching UI keys; no unexplained Chinese literals.`)
