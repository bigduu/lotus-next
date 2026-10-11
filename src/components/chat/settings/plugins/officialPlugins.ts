import type { PluginSourceUrl } from "../../../../services/plugin/types.js"

// Catalogue entries are reviewed, immutable releases. The existing Bamboo
// installer owns signature verification, platform selection and registration.
// Verified against Nova v0.3.1's actual published checksum, signature and manifest.
export const NOVA_PLUGIN = {
  id: "nova",
  version: "0.3.1",
  releaseUrl: "https://github.com/bigduu/Nova/releases/tag/v0.3.1",
  setupUrl: "https://github.com/bigduu/Nova/blob/v0.3.1/README.md",
  source: {
    type: "url",
    url: "https://github.com/bigduu/Nova/releases/download/v0.3.1/nova-plugin-v0.3.1.tar.gz",
    sha256: "445d4d95acfa8d23549ce58716d4944dd83267145461c5f02ec8ba48cb3c30cc",
  } satisfies PluginSourceUrl,
} as const
