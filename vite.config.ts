import { defineConfig } from "vite"
import { configureSolidApplication } from "./vite.solid.config.ts"

export { assertSafePublicBuildEnvironment, developmentProxy, portableArtifactBase, sourceAliases } from "./vite.shared.ts"

export default defineConfig((environment) => configureSolidApplication(environment, "application"))
