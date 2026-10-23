import { readFile, writeFile } from "node:fs/promises"
import { THEME_COLORS, THEME_COLOR_ALIASES } from "../src/shared/theme/colorTokens.ts"

const output = new URL("../src/shared/theme/themeColors.css", import.meta.url)
const declarations = (entries) => entries.map(([name, value]) => `  --${name}: ${value};`).join("\n")
const css = [
  "/* Generated from colorTokens.ts. Run npm run theme:generate; do not edit. */",
  ":root {",
  declarations(Object.entries(THEME_COLORS.light)),
  declarations(Object.entries(THEME_COLOR_ALIASES).map(([name, target]) => [name, `var(--${target})`])),
  "}",
  "",
  ".dark {",
  declarations(Object.entries(THEME_COLORS.dark)),
  "}",
  "",
].join("\n")

if (process.argv.includes("--check")) {
  if (await readFile(output, "utf8") !== css) {
    throw new Error("Theme CSS is out of date. Run npm run theme:generate and commit the result.")
  }
  console.log("Theme CSS matches the shared palette and semantic aliases.")
} else {
  await writeFile(output, css)
  console.log("Generated themeColors.css from the shared color source.")
}
