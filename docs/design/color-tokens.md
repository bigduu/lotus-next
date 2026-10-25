# Chat color tokens

Lotus uses one color source, not an additional theme system:

1. `src/shared/theme/colorTokens.ts` owns sparse light/dark neutral, jade and activity palette steps. Step numbers are local palette identifiers, not a third-party scale.
2. `THEME_COLORS` assigns those steps to semantic purposes. `THEME_COLOR_ALIASES` preserves the existing shadcn/sidebar variable contract. The neutral accent and message presets share the pre-bootstrap CSS fallback. Persisted `teal` and `jade` choices retain their original palette values.
3. Chat, sidebar and composer keep their existing semantic utilities and variables. Activity shimmer reads `--activity-tone` and `--activity-shine`; its normal, reduced-motion and VDI behavior is unchanged.

Edit the TypeScript source, then run `npm run theme:generate`. Commit the generated `themeColors.css`. `npm run theme:check` runs in the normal frontend verification and rejects drift. Generation uses [Node's built-in type stripping](https://nodejs.org/download/release/v22.12.0/docs/api/typescript.html#type-stripping), supported by the existing Node >=22.12 engine; no dependency or runtime stylesheet injection is added.

Do not rename persisted preset IDs or local-storage keys. Existing CSS names remain compatible. User accent overrides still update the existing variables; fixed `--focus-ring` and `--focus-halo` intentionally remain independent so a custom white/black accent cannot hide keyboard focus. Arbitrary custom message/button foregrounds still use their luminance-based choice.

Normal and muted text must retain at least 4.5:1 contrast on canvas, card, popover, sidebar and composer-focus surfaces. Activity-gradient stops need the same text contrast on the transcript canvas where they render; keyboard focus needs at least 3:1 on all five surfaces. Validate both modes and all presets/custom white/black in the browser. Native forced-colors, reduced motion and theme switching remain part of the existing acceptance path.

The Codex-inspired alignment uses neutral canvas, sidebar and composer surfaces, a shared 52rem reading/input column, compact navigation, and flat settings rows. New profiles default to `neutral`; saved color selections retain their preset IDs and are not migrated. Environment keeps its existing automatic-open threshold and bounded content shift. Fixed-alpha mobile scrims, opaque image controls, syntax/diagram colors, interaction state protocols and backend behavior retain their existing treatment.

Current [alignment screenshots and local validation](../screenshots/codex-visual-alignment/README.md) include desktop, tablet and phone surfaces in light and dark modes.

## Historical palette-consolidation acceptance

Synthetic Chromium screenshots at implementation `b84794477699ea6703f5b1f6af603dc8682c6920` match the pre-migration main appearance byte-for-byte in all four pairs. This is a source consolidation, with no intended recoloring. The baseline artifact is `2b8015b12aa69c1f1719c90d26966f40a0eeb756`, whose production sources equal main `c521c6283fdcc22639e4932badafbf11f788aed6`; their difference is a browser-test readiness repair.

| Theme | Desktop, 1440px | Narrow, 390px | Changed pixels in each pair |
| --- | --- | --- | --- |
| Light | [Screenshot](../screenshots/color-tokens-light-1440.png) | [Screenshot](../screenshots/color-tokens-light-390.png) | 0 |
| Dark | [Screenshot](../screenshots/color-tokens-dark-1440.png) | [Screenshot](../screenshots/color-tokens-dark-390.png) | 0 |

Local verification: 191 test files / 4098 units; full frontend verification and original package budgets pass. Affected built-browser matrix: 27 passed, 12 intentional scope skips, 0 failed/flaky with retries disabled. This includes cold CSS without application JavaScript, theme/custom-color persistence, focus/forced colors and thinking disclosure in normal/reduced-motion/VDI modes. Browser inputs are synthetic; physical IME/device and real Bamboo acceptance are not claimed.
