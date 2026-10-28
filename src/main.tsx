import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AppProvider } from './app/AppContext';
import './styles/app.css';
import { AccountGate } from './auth/AccountGate';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AccountGate><AppProvider>
        <App />
      </AppProvider></AccountGate>
    </BrowserRouter>
  </StrictMode>,
);
