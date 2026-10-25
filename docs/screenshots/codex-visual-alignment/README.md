# Codex-inspired visual alignment

Historical browser previews and local validation from WIP `034b049`, originally based on `a5599349859408a7a03848b9ca24fb830e4ccc6c`. This delivery slice is #411; neutral surfaces/settings are delivered separately in #413, and Markdown/Mermaid in #412. Current commit verification is recorded in the delivery PR; the counts and images below describe that earlier combined preview.

The shared palette now defaults to neutral light/dark surfaces. The transcript, composer, menus and home share a 52rem content column. Sidebar typography follows the application font/size tokens; navigation, the composer and flat settings rows use quieter borders and consistent spacing. Saved accent and message-color choices keep their existing preset IDs, and the original jade options remain selectable.

These screenshots show the built frontend with synthetic HTTP/WebSocket fixture data in Chromium. They do not contain user sessions or involve model execution. The chat baseline uses the unchanged source revision above; `toolbar-before-dark.png` records the local toolbar immediately before its typography pass. After screenshots use this branch's working tree.

| Surface | Light | Dark |
| --- | --- | --- |
| Desktop chat, 1440 × 900 | [Before](before-chat-light.png), [after](chat-light.png) | [After](chat-dark.png) |
| Tablet chat, 820 × 1180 | — | [After](chat-tablet-dark.png) |
| Phone chat, 390 × 844 | [After](chat-phone-light.png) | [After](chat-phone-dark.png) |
| Desktop settings, 1440 × 900 | [After](../neutral-surfaces/settings-light.png) | [After](../neutral-surfaces/settings-dark.png) |
| Phone settings, 390 × 844 | [After](../neutral-surfaces/settings-phone-light.png) | [After](../neutral-surfaces/settings-phone-dark.png) |

## Picker and toolbar

The model trigger now fits its label rather than reserving 200px, uses a borderless toolbar treatment, and displays effort in the shared text color. Model/effort text is separated by 6px; the desktop permission control, model trigger and send action share a measured vertical center (0px difference). Narrow composers use a stable two-row toolbar so confirmed Ultra labels cannot unexpectedly increase the input surface height.

| Detail | Light | Dark |
| --- | --- | --- |
| Desktop input and toolbar | [After](composer-light.png) | [After](composer-dark.png) |
| Phone input and toolbar | [After](composer-phone-light.png) | [After](composer-phone-dark.png) |
| New-draft toolbar | — | [After](composer-new-draft-dark.png) |
| Phone secondary controls | — | [After](composer-phone-more-dark.png) |
| Streaming input and toolbar | — | [Desktop](composer-streaming-dark.png), [phone](composer-streaming-phone-dark.png) |
| Selected workflow | — | [After](composer-workflow-dark.png) |
| Model trigger | — | [After](model-trigger-dark.png) |
| Ordinary effort popup | [After](picker-normal-light.png) | [After](picker-normal-dark.png) |
| Ultra popup | [After](picker-ultra-light.png) | [After](picker-ultra-dark.png) |
| Phone Ultra popup | — | [After](picker-ultra-phone-dark.png) |

The popup follows the supplied compact reference: mode heading, model entry, reset action and slider. The descriptive footer, endpoint captions and their reserved space are removed. The mode label is simply `Ultra` in both Chinese and English, including the trigger, popup heading and accessible description. Both ordinary and Ultra views measure 256 × 118px. The standalone toolbar introduction button is removed; screen-reader state announcements and visible error/recovery controls remain. Model selection, effort/Ultra behavior, permission handling and workflow actions retain their existing contracts.

The full composer pass uses one shared style for permission, model, Project, workspace, prompt and selected-workflow controls. Toolbar text is 14px / 20px at weight 400; action buttons are 32px high, primary icons are 16px, and dropdown chevrons are 12px. Adjacent controls have a 4px gap, with 6px between a control's text and icons. The permission shield is inside its actual focusable trigger. Default desktop controls and all their icons share a measured vertical center with no difference.

The editor keeps 16px / 24px text with symmetric 8px horizontal padding. Output speed lives in the toolbar, so appearing/disappearing metadata cannot take 128px away from every input line. The Stop square inherits its foreground from the theme rather than staying white on the dark theme's light button. Responsive secondary menus and the selected workflow use the same control dimensions. [Toolbar before this pass](toolbar-before-dark.png).

Validation of the alignment and toolbar passes (the Markdown follow-up is recorded below):

- `npm run test:run -- --maxWorkers=2`: 228 files / 4,654 tests passed after the complete composer pass, including the registry readback fixtures that had timed out during earlier concurrent runs.
- Production build/type check, lint, theme generation check, i18n, architecture and package verification passed. Initial CSS is 108,841 bytes, below the unchanged 109,000-byte ceiling (baseline: 108,970 bytes).
- Affected browser coverage: 55 cases passed, 41 intentional project/viewport skips, across the seven-file run below and a focused rerun of the six localized toolbar-status cases. The initial status expectations assumed a new draft; they now explicitly restore the fixture session and assert its confirmed status. No application-source change was needed for that test correction.
- After simplifying the Ultra label, the model/effort picker, root orchestration and Supervisor work availability browser suites passed again: 104 passed / 31 intentional project skips. The Ultra screenshots above were refreshed from the rebuilt frontend; light, dark and phone popups show only `Ultra`.
- The complete composer pass passed 103 browser cases / 65 intentional project skips across nine affected files. The final selected-workflow adjustment and typography/streaming matrix passed another 20 cases / 28 project skips (including the 12 geometry/streaming cases repeated from the larger run). Together these cover 111 distinct passing browser cases. Explicit 320/390/820/1440px tests cover light/dark themes, Chinese/English labels, 32px controls, icon centering, symmetric input padding and drafts preserved across menus. Live synthetic token arrivals verify that rate metadata leaves the editor geometry unchanged and Stop inherits a visible foreground.

```sh
npx playwright test e2e/model-effort-picker.spec.ts e2e/root-orchestration.spec.ts e2e/composer-status.spec.ts e2e/composer-container.spec.ts e2e/chat-layout.spec.ts e2e/visual-surfaces.spec.ts e2e/reasoning-settings.spec.ts --workers=3
npx playwright test e2e/composer-status.spec.ts --workers=3
npx playwright test e2e/model-effort-picker.spec.ts e2e/root-orchestration.spec.ts e2e/supervisor-work-availability.spec.ts --workers=3
npx playwright test e2e/composer-visual-alignment.spec.ts e2e/model-effort-picker.spec.ts e2e/composer-status.spec.ts e2e/composer-container.spec.ts e2e/composer-editor.spec.ts e2e/composer-enter.spec.ts e2e/queued-guidance-live.spec.ts e2e/chat-layout.spec.ts e2e/root-orchestration.spec.ts --workers=3
npx playwright test e2e/composer-visual-alignment.spec.ts e2e/typed-workflow.spec.ts --workers=3
```

Browser checks cover actual popup/toolbar geometry, long model names, locale differences, keyboard/IME behavior, forced colors, responsive settings, side panes, pending/confirmed Ultra stability, ordinary-effort preservation, failed mode changes and recovery after reload. The initial alignment also passed the home-feedback, Markdown-theme and pre-bootstrap color suites (29 passed / 16 scope skips).

The subsequent [Markdown readability and individual Mermaid repair](https://github.com/bigduu/lotus-next/issues/412) pass adds theme-aware diagrams and per-diagram recovery, fixes reduced-motion SVG clipping, and records the current combined verification (4,657 unit tests; 54 focused browser cases).
