import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen, ScanLoader } from './ScanState';
import { reloadOnceForNewRelease, sessionStore, willReloadFor } from '../app/errorReport';

interface State {
  error: unknown;
  stack: string | null;
  /** A release replaced a code file: the tab reloads once instead of showing the error. */
  reloading: boolean;
}

/**
 * The last line of defence around the whole app (sign-in gate, top bar, pages). Without it, an error outside a page
 * unmounted everything and left a black screen. Pages have their own boundary (ErrorBoundary.tsx), so the top bar
 * stays usable when only a page fails.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: null, reloading: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, reloading: willReloadFor(error, sessionStore()) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('App error', error, info.componentStack);
    const stack = error instanceof Error && error.stack ? error.stack : (info.componentStack ?? null);
    const reloading = this.state.reloading && reloadOnceForNewRelease(sessionStore(), () => window.location.reload());
    this.setState({ stack, reloading });
  }

  render() {
    if (this.state.error == null) return this.props.children;
    if (this.state.reloading) return <ScanLoader label="Updating to the latest version…" />;
    return <ErrorScreen error={this.state.error} scope="app" stack={this.state.stack} />;
  }
}
