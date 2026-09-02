# Production startup bundle budget

Issue #32 replaces the old catch-all chunk snapshot with an executable budget
for the JavaScript that ordinary chat actually loads immediately. The previous
snapshot remains useful history, but a single vendor file size could not prove
that optional Settings, renderer, or export code stayed off the startup path.

## Frozen pre-change baseline

The baseline was reproduced from
`main@bb59f562214a5a20ae1efadd5c1641374411dcb0` after a clean `npm ci` and
production build. Vite transformed 3,085 modules.

The immediate JavaScript closure is defined from generated artifacts, not from
source estimates:

1. the sole `index.html` manifest entry and every JavaScript file referenced by
   the generated HTML;
2. the entry's two immediately awaited bootstrap imports, `Root` and
   `ErrorBoundary`;
3. every recursive static manifest import owned by those entries;
4. no feature `dynamicImports` below `Root`.

| Immediate asset | Raw bytes | Deterministic gzip bytes |
| --- | ---: | ---: |
| HTML entry | 11,273 | 4,862 |
| Rolldown runtime | 694 | 423 |
| React vendor | 189,644 | 58,960 |
| Generic vendor | 1,070,813 | 321,940 |
| Shared button | 1,382 | 694 |
| Root | 673,734 | 179,599 |
| ErrorBoundary | 1,762 | 1,004 |
| **Total** | **1,949,302** | **567,482** |

Compression is intentionally not Node's `zlib`: its output changed across
supported Node majors. The verifier pins `pako@2.2.0`, gzip level 6, timestamp
0, and OS byte 255 so Node 22 and Node 24 enforce the same bytes.

## Accepted Settings feature boundary

The Issue #32 implementation keeps one eager Radix responsive-dialog shell but
loads its Settings content, tabs, metrics, and plugin clients only after a real
open action. The generated ownership manifest records repository-relative
modules and normalized package names for every output chunk, allowing the
verifier to detect feature code hidden inside a shared startup chunk instead of
trusting filenames.

| Measurement | Pre-change | Issue #32 result | Change |
| --- | ---: | ---: | ---: |
| Immediate JS raw | 1,949,302 B | 992,616 B | -956,686 B / -49.08% |
| Immediate JS gzip | 567,482 B | 301,093 B | -266,389 B / -46.94% |
| Initial CSS raw | 101,066 B | 101,066 B | no change |
| Initial CSS gzip | 16,422 B | 16,422 B | no change |

The independent Settings entry is 198,057 B raw / 47,466 B deterministic
gzip. Its hashed filename changes with source edits; the manifest source owner
`src/components/chat/Settings.tsx` is the stable contract.

The previous catch-all vendor group was removed. Explicit renderer groups stay
stable, while otherwise unknown packages now follow the static or dynamic
application graph that owns them. This keeps Settings-only Radix packages and
PDF-only rendering packages out of ordinary chat instead of merging them into
an eager generic vendor chunk.

## Enforced gates

`npm run build` emits `dist/asset-manifest.json` and the normalized
`dist/bundle-ownership.json`. `npm run package:contents` then fails unless all
of these remain true:

- immediate JS is at most 1,820,000 B raw and 535,000 B gzip;
- the frozen baseline improves by at least 6% raw and 5% gzip;
- initial CSS is at most 105,000 B raw and 18,000 B gzip;
- bootstrap dynamic owners are exactly `Root` and `ErrorBoundary`;
- `Root` owns one dynamic Settings entry;
- Settings, settings tabs, metrics/plugin services, Markdown, Mermaid,
  highlighter, and PDF/export modules remain outside the immediate closure;
- Settings-only `@radix-ui/react-label` and `@radix-ui/react-switch`, plus
  PDF-only `html2canvas`, `jspdf`, `canvg`, `fast-png`, `fflate`, and `pako`,
  plus their optional renderer/canvas/parser support packages, remain outside
  the immediate closure;
- the Settings static feature closure still owns its Settings, metrics, plugin,
  label, and switch implementation, so moving them to a shared eager chunk
  cannot evade the check.

Equivalent local verification is:

```bash
npm ci
npm run build
npm run package:contents
```

Vite can still report large optional Mermaid/highlighter/code chunks. Those are
not ignored: their dynamic ownership is explicitly frozen here. Further feature
splitting should be a separately measured Issue rather than an arbitrary global
manual-chunk rewrite.

## Historical snapshot

At `e3b6911d92316410caddfd8da113afba3da039eb`, the pre-foundation build emitted
a roughly 4.47 MB raw catch-all vendor chunk and eagerly preloaded it. That
snapshot predates the canonical renderer/runtime slices and is not used as the
current executable budget.
