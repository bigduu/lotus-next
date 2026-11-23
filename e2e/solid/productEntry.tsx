import { Errored } from "solid-js"
import { render } from "@solidjs/web"
import { resolveDefaultBrowserRuntimeConfig } from "../../src/runtime/browserRuntime"
import { installRuntimeConfig } from "../../src/runtime/runtimeConfig"
import "../../src/solid/styles.css"

const root = document.getElementById("root")
if (!root) throw new Error("Lotus Next root element is missing.")

// Exercise the actual Solid app against the host contract without packaging
// a second application bootstrap entry into the existing product.
installRuntimeConfig(resolveDefaultBrowserRuntimeConfig())
const [{ SolidRoot }, { SolidApp }] = await Promise.all([
  import("../../src/solid/bootstrap/Root"),
  import("../../src/solid/shell/SolidApp"),
])
render(() => (
  <Errored fallback={(error) => {
    console.error(error())
    return <p role="alert">Lotus Next could not start.</p>
  }}>
    <SolidRoot renderApp={(ownerAccess) => <SolidApp ownerAccess={ownerAccess} />} />
  </Errored>
), root)
