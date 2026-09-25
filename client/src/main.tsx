import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import ErrorBoundary from '@/components/common/ErrorBoundary';
import { queryClient } from '@/services/queryClient';
import './index.css';
// Must be imported before anything renders: captures `beforeinstallprompt`
// at module scope so the one-click Install button never misses the event.
import '@/utils/installPrompt';

if (import.meta.env.DEV) {
  import('./utils/layoutAudit');
}

// PWA installability: Chromium browsers require a service worker with a
// fetch handler before they'll offer the native one-click install dialog.
// public/sw.js is network-first (never serves stale content while online).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* install prompt is a bonus; the app works without it */
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
 <React.StrictMode>
 <QueryClientProvider client={queryClient}>
 <BrowserRouter>
 <ErrorBoundary>
 <App />
 </ErrorBoundary>
 <Toaster
 position="top-center"
 containerStyle={{
 // Toasts must clear the fixed topbar (and iPhone notch) instead of sliding under it
 top: 80,
 zIndex: 100,
 }}
 toastOptions={{
 style: {
 border: '3px solid #0F172A',
 borderRadius: '12px',
 fontFamily: '"DM Sans", sans-serif',
 fontWeight: 500,
 boxShadow: '4px 4px 0px 0px #0F172A',
 maxWidth: 'calc(100vw - 2rem)',
 },
 }}
 />
 </BrowserRouter>
 </QueryClientProvider>
 </React.StrictMode>
);
