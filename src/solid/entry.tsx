import { Errored } from "solid-js"
import { render } from "@solidjs/web"
import { installAssetRecovery, renderBootstrapFailure } from "../runtime/browserEntrySupport"
import { resolveDefaultBrowserRuntimeConfig } from "../runtime/browserRuntime.ts"
import { installRuntimeConfig } from "../runtime/runtimeConfig.ts"
import "./styles.css"

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("Lotus Next root element is missing.")
const root = rootElement

installAssetRecovery()

async function start() {
  // Services read this immutable contract on import.
  installRuntimeConfig(resolveDefaultBrowserRuntimeConfig())
  const [{ SolidRoot }, { SolidApp }] = await Promise.all([
    import("./bootstrap/Root"),
    import("./shell/SolidApp"),
  ])

  render(() => (
    <Errored fallback={(error) => {
      console.error("[runtime] Lotus Next Solid UI failed:", error())
      return <p role="alert">Lotus Next could not start.</p>
    }}>
      <SolidRoot renderApp={(ownerAccess) => <SolidApp ownerAccess={ownerAccess} />} />
    </Errored>
  ), root)
}

void start().catch((error) => renderBootstrapFailure(root, error))
