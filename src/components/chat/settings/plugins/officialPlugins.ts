import type { PluginSourceUrl } from "../../../../services/plugin/types.js"

// Catalogue entries are reviewed, immutable releases. The existing Bamboo
// installer owns signature verification, platform selection and registration.
// Verified against Nova v0.3.0's published archive checksum and manifest.
export const NOVA_PLUGIN = {
  id: "nova",
  version: "0.3.0",
  releaseUrl: "https://github.com/bigduu/Nova/releases/tag/v0.3.0",
  setupUrl: "https://github.com/bigduu/Nova/blob/v0.3.0/README.md",
  source: {
    type: "url",
    url: "https://github.com/bigduu/Nova/releases/download/v0.3.0/nova-plugin-v0.3.0.tar.gz",
    sha256: "85f36853a3a69c7e2268f6db35becde352649758822fb5277bc97413d083b371",
  } satisfies PluginSourceUrl,
} as const
