import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './ScanState';

/**
 * The last line of defence around the whole app (sign-in gate, top bar, pages). Without it, an error outside a page
 * unmounted everything and left a black screen. Pages have their own boundary (ErrorBoundary.tsx), so the top bar
 * stays usable when only a page fails.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { error: unknown; stack: string | null }> {
  state = { error: null as unknown, stack: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('App error', error, info.componentStack);
    this.setState({ stack: error instanceof Error && error.stack ? error.stack : (info.componentStack ?? null) });
  }

  render() {
    if (this.state.error == null) return this.props.children;
    return <ErrorScreen error={this.state.error} scope="app" stack={this.state.stack} />;
  }
}
