import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Analytics } from '@vercel/analytics/react';
import { App } from './App';
import { AppProvider } from './app/AppContext';
// Brand typeface, self-hosted (no third-party font request). The optical-size axis gives large headings Inter's
// display cut automatically, the way SF Pro switches from Text to Display.
import '@fontsource-variable/inter/opsz.css';
import './styles/app.css';
import { AccountGate } from './auth/AccountGate';
import { RootErrorBoundary } from './components/RootErrorBoundary';
import { ScanLoader } from './components/ScanState';
import { AUTO_RELOAD_KEY, mayAutoReload } from './app/errorReport';

// A release replaced the code files this tab was built against (or the connection dropped mid-download): reload once
// to pick up the new ones. A second failure within a minute goes to the error screen instead of looping.
window.addEventListener('vite:preloadError', (event) => {
  let last: string | null = null;
  try {
    last = sessionStorage.getItem(AUTO_RELOAD_KEY);
  } catch {
    /* storage blocked: fall through to the error screen */
    return;
  }
  if (!mayAutoReload(last, Date.now())) return;
  try {
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

// A certificate's public page opens for anyone, without signing in.
const CertificatePage = lazy(() => import('./pages/CertificatePage'));
const publicCertificate = /^\/(certificate|verify)\//.test(location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RootErrorBoundary>
        {publicCertificate ? (
          <Suspense fallback={<ScanLoader label="Opening the certificate…" />}>
            <CertificatePage />
          </Suspense>
        ) : (
          <AccountGate><AppProvider>
            <App />
          </AppProvider></AccountGate>
        )}
      </RootErrorBoundary>
      {/* Cookieless page views (query strings dropped: they can hold task ids or codes). */}
      <Analytics beforeSend={(e) => ({ ...e, url: e.url.split('?')[0] })} />
    </BrowserRouter>
  </StrictMode>,
);
