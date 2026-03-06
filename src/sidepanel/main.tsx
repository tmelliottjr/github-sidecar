import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { App } from './App';
import './styles/index.css';

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: CACHE_TTL,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const chromePersister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string): Promise<string | null> => {
      const result = await chrome.storage.local.get(key);
      return (result[key] as string) ?? null;
    },
    setItem: async (key: string, value: string) => {
      await chrome.storage.local.set({ [key]: value });
    },
    removeItem: async (key: string) => {
      await chrome.storage.local.remove(key);
    },
  },
  key: 'sidecar-query-cache',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: chromePersister,
        maxAge: CACHE_TTL,
        buster: '1',
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
