import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import ErrorBoundary from '@/components/common/ErrorBoundary';
import './index.css';

if (import.meta.env.DEV) {
  import('./utils/layoutAudit');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
              border: '3px solid #1a1a1a',
              borderRadius: '12px',
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              boxShadow: '4px 4px 0px 0px #1a1a1a',
              maxWidth: 'calc(100vw - 2rem)',
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
