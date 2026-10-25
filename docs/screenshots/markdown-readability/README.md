# Markdown readability and individual Mermaid repair

Historical browser previews and local validation from preserved WIP `034b049`, based on `a5599349859408a7a03848b9ca24fb830e4ccc6c`. This delivery slice is #412. Current commit verification is recorded in the delivery PR; the counts and resource identity below describe that earlier combined preview.

All images use the production frontend and synthetic Chromium HTTP/WebSocket fixtures. They contain no user sessions and do not invoke a model. This is browser acceptance, not native WebKit or published-release acceptance.

The audit reproduced three concrete problems:

- App Mermaid used a frozen dark theme in light mode. Edge labels were `rgb(204, 204, 204)` on a white background. App diagrams now use the resolved light/dark theme and redraw when it changes; PDF export restores the current app theme. The shared strict/native-label policy stays frozen.
- Failed diagrams showed only escaped source, with the actual error hidden and no local recovery actions. Both assistant and legacy Markdown now share per-diagram source editing, preview, retry, error details and restore. Edits affect only the current preview, reset when the source message changes or the page reloads, and do not write history. The UI states this limitation explicitly. Sibling diagrams and message text remain unchanged; keyboard cancellation and Chinese IME are covered.
- Reduced motion forced every element to a nonzero transition duration. SVG node transforms could therefore still be transitioning when Mermaid measured its viewBox, clipping valid diagrams. Reduced-motion transitions now use `0s`; browser checks require the SVG viewBox to contain its actual graphic bounds. Animation completion behavior remains on the existing short animation duration.

The assistant code theme now uses `github-dark-default`; the previous dark comment contrast measured 3.34:1. Paired-theme tests verify at least 4.5:1 for body, quotes, links, inline code, table text and highlighted comments. Mermaid edge labels meet 4.5:1 and connections meet 3:1 on the app background. Existing CJK font smoothing, sanitization, lazy loading and URL restrictions remain in place.

| View | Evidence |
| --- | --- |
| Light theme and failed diagram | [Screenshot](mermaid-light.png) |
| Source editor and explicit local-preview limitation | [Screenshot](mermaid-editor-light.png) |
| Independently repaired chart in light mode | [Screenshot](mermaid-repaired-light.png) |
| Same repaired chart after changing to dark mode | [Screenshot](mermaid-repaired-dark.png) |
| 390px source editor | [Screenshot](mermaid-editor-phone-light.png) |
| 320px repaired diagram | [Screenshot](mermaid-repaired-phone-dark.png) |
| Reduced-motion clipping before the transition fix | [Screenshot](mermaid-cropped-before.png) |

Validation:

- Full Vitest: 228 files / 4,657 passed.
- Affected browser suite below: 54 passed / 66 intentional project skips. This includes 320/390/1440px Mermaid cases, both themes, sibling isolation, retry, edit, cancel, restore, theme changes, unchanged history, complete SVG bounds, highlighted prose/code, streaming caret/selection and composer/model controls.
- Build/type check, lint, i18n (2,655 matching keys), architecture and package checks passed. Initial CSS is 108,838 bytes, below the unchanged 109,000-byte ceiling.
- Built resource identity: `d0a5d30eb43275fddef8816029004464e0f8b6f5d1e9a919028cc0dbe96bef99`; source is the local dirty tree, not a published package.

```sh
npm run test:run -- --maxWorkers=2
npx playwright test e2e/mermaid-repair.spec.ts e2e/markdown-theme.spec.ts e2e/renderer-styles.spec.ts e2e/streamdown-built.spec.ts e2e/streaming-caret-clipping.spec.ts e2e/composer-visual-alignment.spec.ts e2e/model-effort-picker.spec.ts --workers=3
```
