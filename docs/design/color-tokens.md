# Chat color tokens

Lotus uses one color source, not an additional theme system:

1. `src/shared/theme/colorTokens.ts` owns sparse light/dark neutral, jade and activity palette steps. These preserve the existing appearance; step numbers are local palette identifiers, not a third-party scale.
2. `THEME_COLORS` assigns those steps to semantic purposes. `THEME_COLOR_ALIASES` preserves the existing shadcn/sidebar variable contract. The persisted `teal` accent and `jade` message presets read the same source as the CSS fallback.
3. Chat, sidebar and composer keep their existing semantic utilities and variables. Activity shimmer reads `--activity-tone` and `--activity-shine`; its normal, reduced-motion and VDI behavior is unchanged.

Edit the TypeScript source, then run `npm run theme:generate`. Commit the generated `themeColors.css`. `npm run theme:check` runs in the normal frontend verification and rejects drift. Generation uses [Node's built-in type stripping](https://nodejs.org/download/release/v22.12.0/docs/api/typescript.html#type-stripping), supported by the existing Node >=22.12 engine; no dependency or runtime stylesheet injection is added.

Do not rename persisted preset IDs or local-storage keys. Existing CSS names remain compatible. User accent overrides still update the existing variables; fixed `--focus-ring` and `--focus-halo` intentionally remain independent so a custom white/black accent cannot hide keyboard focus. Arbitrary custom message/button foregrounds still use their luminance-based choice.

Normal and muted text must retain at least 4.5:1 contrast on canvas, card, popover, sidebar and composer-focus surfaces. Activity-gradient stops need the same text contrast on the transcript canvas where they render; keyboard focus needs at least 3:1 on all five surfaces. Validate both modes and all presets/custom white/black in the browser. Native forced-colors, reduced motion and theme switching remain part of the existing acceptance path.

This slice covers shared chat surfaces and activity colors. Fixed-alpha mobile scrims and opaque image controls retain their existing treatments. Syntax/diagram colors, unrelated settings, typography, interaction state protocols and backend behavior are outside this migration.
