# README source and release audit

Checked 2026-10-03. These are observed identities, not moving-version promises.

| Boundary | Evidence |
|---|---|
| Zenith pin | `1131c275cb441694a41f996228d9f91473d920f5` before this documentation-only commit |
| Observed upstream main | `git ls-remote origin refs/heads/main` returns the same `1131c275…` |
| npm latest | `npm view @bigduu/lotus-next version dist-tags --json`: `2026.9.22` |
| Published source | [Official registry tarball](https://registry.npmjs.org/@bigduu/lotus-next/-/lotus-next-2026.9.22.tgz), `package/dist/lotus-next-manifest.json`: source `a480e2bb94f5dd08fe4b01b2f8844a2c9ed03245`, `sourceDirty: false` |
| Artifact digest | Registry SHA-1 `12e99c8871a9e5f80ae5c808a9f38b0b28d00b24`; manifest resource-set SHA-256 `91d7c30fb0fc9b3a4d811f3099eeed7fb888315f03678a3a388e4a921bccf3d6` |
| Desktop consumer | [Bodhi app-v2026.9.20](https://github.com/bigduu/Bodhi-AI/releases/tag/app-v2026.9.20) tag's package lock selects `2026.9.16`; Zenith-pinned Bodhi instead selects `2026.9.22` |

There are 117 commits reachable from the source pin after the published manifest's source. Recent source history includes actor-stream continuity, typed workflow selection and permission reconciliation; these are not advertised as already present in the npm package or desktop installer. No unmerged Supervisor/owner branch is used as a release claim.

The obsolete statement that legacy Lotus remains the current production default was removed: the pinned Bodhi consumer already locks Lotus Next, and its latest public installer also locks Lotus Next. Explicit legacy rollback selection remains a separate consumer concern.

Sources reviewed:

- [package.json](../package.json): minimum Node version, frontend-only package and runnable scripts.
- [vite.config.ts](../vite.config.ts): ports, LAN default, loopback override, proxy and portable asset paths.
- [runtime](../src/runtime): browser/Tauri endpoint selection.
- [chat components](../src/components/chat): settings, session navigation, tool/approval and split-view UI.
- [export helpers](../src/lib/exportMarkdown.ts), [PDF export](../src/lib/exportPdf.ts), [i18n](../src/shared/i18n/index.ts).
- Existing packaging and real-runtime acceptance instructions retained in [verification.md](verification.md); the older `2026.9.14` published-artifact acceptance fixture is intentionally not relabeled as npm latest.

Validation: relative Markdown links and package-script references checked; `git diff --check` passed. This audit verifies source and artifact identity, not end-to-end model behavior. Browser/terminal recordings, if added, must disclose their precise runtime and any synthetic data; none is evidence of native macOS/Windows acceptance. No user credentials, production settings or private sessions were read.

## Approved brand illustration

The user-approved nature illustration is saved at `docs/assets/lotus-next-nature-hero.png`.
The original PNG was visually inspected and decoded, and its SHA-256 matched
the approved image package. It is a brand illustration, not a software screenshot;
the README alt text and visible caption say so. Existing source/release and
recording limits still apply. The older artwork remains in repository history
and any existing SVG asset is preserved.

- Pixels: 1672 × 941 (RGB PNG)
- Bytes: 1948241
- SHA-256: `74c6bcff536c2d1703b626a02691d536102f9625fd69fdd18e9c5c6f25f77f9b`
