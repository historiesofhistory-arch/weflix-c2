import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WatchlistProvider } from './context/WatchlistContext'
import { ToastProvider } from './components/Toast'
import './index.css'
import App from './App.jsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <HelmetProvider>
      <ToastProvider>
        <WatchlistProvider>
          <App />
        </WatchlistProvider>
      </ToastProvider>
    </HelmetProvider>
  </QueryClientProvider>,
)
