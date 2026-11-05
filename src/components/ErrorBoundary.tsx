import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { reportCrash } from "../services/crashReporter";

interface Props {
  children: ReactNode;
  /** The boundary clears its error when this changes, e.g. when the user switches screens. */
  resetKey?: string;
  /** Whole-app boundaries reload the page because no parent UI is left to recover into. */
  fullScreen?: boolean;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Screen crashed:", error, info.componentStack);
    reportCrash(error, "screen");
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private handleRetry = () => {
    if (this.props.fullScreen) {
      window.location.reload();
    } else {
      this.setState({ hasError: false });
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className={`${this.props.fullScreen ? "min-h-screen" : "h-full"} flex items-center justify-center bg-app-bg p-6`}
      >
        <div className="w-full max-w-sm bg-app-card border border-app-border rounded-3xl p-6 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" aria-hidden="true" />
          <h2 className="text-sm font-bold text-app-text">This screen couldn't be loaded</h2>
          <p className="text-xs text-app-text-muted">
            Your data is safe. Please try again, and contact support if this keeps happening.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
