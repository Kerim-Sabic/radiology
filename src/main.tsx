import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Analytics } from '@vercel/analytics/react';
import { App } from './App';
import { AppProvider } from './app/AppContext';
// Brand typefaces, self-hosted (no third-party font request): Inter for text, Plus Jakarta Sans for headings.
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './styles/app.css';
import { AccountGate } from './auth/AccountGate';

// A certificate's public page opens for anyone, without signing in.
const CertificatePage = lazy(() => import('./pages/CertificatePage'));
const publicCertificate = location.pathname.startsWith('/certificate/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {publicCertificate ? (
        <Suspense fallback={null}>
          <CertificatePage />
        </Suspense>
      ) : (
        <AccountGate><AppProvider>
          <App />
        </AppProvider></AccountGate>
      )}
      {/* Cookieless page views (query strings dropped: they can hold task ids or codes). */}
      <Analytics beforeSend={(e) => ({ ...e, url: e.url.split('?')[0] })} />
    </BrowserRouter>
  </StrictMode>,
);
