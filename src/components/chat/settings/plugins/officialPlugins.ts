import type { PluginSourceUrl } from "../../../../services/plugin/types.js"

// Catalogue entries are reviewed, immutable releases. The existing Bamboo
// installer owns signature verification, platform selection and registration.
// Re-pinned for the Nova v0.3.1 assets republished on 2026-10-25: the previous
// digest no longer describes the published bundle, so installing with it fails
// checksum verification on the server.
export const NOVA_PLUGIN = {
  id: "nova",
  version: "0.3.1",
  releaseUrl: "https://github.com/bigduu/Nova/releases/tag/v0.3.1",
  setupUrl: "https://github.com/bigduu/Nova/blob/v0.3.1/README.md",
  source: {
    type: "url",
    url: "https://github.com/bigduu/Nova/releases/download/v0.3.1/nova-plugin-v0.3.1.tar.gz",
    sha256: "9eadc3ee0355f1aff047329f41e027405c68a519686efb9bc22ac91cf055b95a",
  } satisfies PluginSourceUrl,
} as const
