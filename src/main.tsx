import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { resolveDefaultBrowserRuntimeConfig } from './runtime/browserRuntime.ts'
import { installAssetRecovery, renderBootstrapFailure } from './runtime/browserEntrySupport.ts'
import { installRuntimeConfig } from './runtime/runtimeConfig.ts'

installAssetRecovery()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Lotus Next root element is missing.')
}

const bootstrap = async () => {
  // This synchronous installation is the composition boundary: Root and every
  // service singleton are imported only after one immutable runtime exists.
  installRuntimeConfig(resolveDefaultBrowserRuntimeConfig())
  const [{ default: Root }, { default: ErrorBoundary }] = await Promise.all([
    import('./Root.tsx'),
    import('./components/app/ErrorBoundary.tsx'),
  ])

  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary name="Root">
        <Root />
      </ErrorBoundary>
    </StrictMode>,
  )
}

void bootstrap().catch((error) => renderBootstrapFailure(rootElement, error))
