import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './ScanState';

interface Props {
  children: ReactNode;
  /** The page's address: moving to another page clears the error. */
  resetKey: string;
}

/**
 * One page failing never leaves a black screen: it shows the reading-room error screen (what happened, the
 * message, Reload / Go to Today / Copy details) while the top bar stays usable. Submitted answers are already
 * saved by then, so nothing is lost. A failed code download after a release is reloaded automatically once
 * (main.tsx, vite:preloadError) before it ever reaches here.
 */
export class ErrorBoundary extends Component<Props, { error: unknown; stack: string | null }> {
  state = { error: null as unknown, stack: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Page error', error, info.componentStack);
    this.setState({ stack: error instanceof Error && error.stack ? error.stack : (info.componentStack ?? null) });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error != null && prev.resetKey !== this.props.resetKey) this.setState({ error: null, stack: null });
  }

  render() {
    if (this.state.error == null) return this.props.children;
    return <ErrorScreen error={this.state.error} scope="page" stack={this.state.stack} />;
  }
}
