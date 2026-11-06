import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen, ScanLoader } from './ScanState';
import { reloadOnceForNewRelease, sessionStore, willReloadFor } from '../app/errorReport';

interface Props {
  children: ReactNode;
  /** The page's address: moving to another page clears the error. */
  resetKey: string;
}

interface State {
  error: unknown;
  stack: string | null;
  /** A release replaced this page's code file: the tab reloads once instead of showing the error. */
  reloading: boolean;
}

/**
 * One page failing never leaves a black screen: it shows the reading-room error screen (what happened, the
 * message, Reload / Go to Today / Copy details) while the top bar stays usable. Submitted answers are already
 * saved by then, so nothing is lost. A code file that failed after a release reloads the tab once first.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null, reloading: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, reloading: willReloadFor(error, sessionStore()) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Page error', error, info.componentStack);
    const stack = error instanceof Error && error.stack ? error.stack : (info.componentStack ?? null);
    const reloading = this.state.reloading && reloadOnceForNewRelease(sessionStore(), () => window.location.reload());
    this.setState({ stack, reloading });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error != null && prev.resetKey !== this.props.resetKey) this.setState({ error: null, stack: null, reloading: false });
  }

  render() {
    if (this.state.error == null) return this.props.children;
    if (this.state.reloading) return <ScanLoader label="Updating to the latest version…" compact />;
    return <ErrorScreen error={this.state.error} scope="page" stack={this.state.stack} />;
  }
}
