import { Component, type ErrorInfo, type ReactNode } from 'react';
import { House, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** The page's address: moving to another page clears the error. */
  resetKey: string;
}

/** A page's code file failed to load: a dropped connection, or a release replaced the old files. A reload fixes either. */
const isStaleRelease = (e: Error) => /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(e.message);

/**
 * One page failing never leaves a black screen: it says what happened and offers a reload or the way home.
 * Submitted answers are already saved by then, so nothing is lost.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page error', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleRelease(error);
    return (
      <div className="page-inner page-problem" role="alert">
        <h1>{stale ? 'This page didn’t finish loading' : 'This page hit a problem'}</h1>
        <p className="muted">
          {stale
            ? 'The connection may have dropped, or Radiology Monster was updated while this tab was open. Check your signal, then reload. Answers you submitted are kept.'
            : 'Something went wrong while showing this page. Answers you submitted are kept. Reload to try again, or go back to Today.'}
        </p>
        <div className="row wrap">
          <button className="btn primary lg" onClick={() => window.location.reload()}>
            <RotateCw size={16} /> Reload
          </button>
          <a className="btn lg" href="/">
            <House size={16} /> Go to Today
          </a>
        </div>
      </div>
    );
  }
}
