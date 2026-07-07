import { Component, useState, type ErrorInfo, type ReactNode } from "react"
import { Bug, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional custom fallback. When omitted the default card is rendered. */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  /** Identifier for logging (e.g. "ChatPane", "Settings"). */
  name?: string
  /** Callback when an error is caught. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Generic React Error Boundary.
 *
 * Catches uncaught exceptions in the subtree and renders a recoverable
 * fallback UI instead of unmounting (white-screening) the entire app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const label = this.props.name ?? "ErrorBoundary"
    console.error(`[${label}] Uncaught error:`, error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    const { fallback } = this.props
    const error = this.state.error!

    if (typeof fallback === "function") {
      return fallback(error, this.handleReset)
    }
    if (fallback !== undefined) {
      return fallback
    }

    return <DefaultErrorFallback error={error} onReset={this.handleReset} />
  }
}

function DefaultErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div
      role="alert"
      className="flex min-h-[200px] flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <Bug className="size-9 text-amber-500" />
      <div className="text-base font-semibold">页面出错了</div>
      <p className="max-w-md text-sm text-muted-foreground">
        这个区域渲染时发生了异常。你可以重试;若持续出错,请刷新页面。
      </p>
      <div className="mt-1 flex gap-2">
        <Button size="sm" onClick={onReset}>
          <RotateCcw className="size-4" />
          重试
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
          {showDetails ? "隐藏详情" : "显示详情"}
        </Button>
      </div>
      {showDetails && (
        <pre className="mt-2 max-h-[200px] w-full max-w-xl overflow-auto rounded-md bg-muted p-3 text-left text-xs">
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
      )}
    </div>
  )
}

export default ErrorBoundary
