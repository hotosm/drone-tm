import '@hotosm/ui/dist/style.css';

import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { PersistGate } from 'redux-persist/integration/react';
import '@Assets/css/index.css';
import '@Assets/css/tailwind.css';
import { store, persistor } from './store';
import App from './App';

// Import Web Awesome components needed by hanko-auth web component
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

// Workaround required, as @hotosm/gcp-editor already imports all components
if (!customElements.get('hot-tracking')) {
  import('@hotosm/ui/dist/hotosm-ui');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <Provider store={store}>
      <PersistGate loading={<h1>hello</h1>} persistor={persistor}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <hot-tracking
          style={{ position: 'fixed', bottom: '0%' }}
          site-id="35"
          domain="dronetm.org"
        />
      </PersistGate>
    </Provider>
    <ReactQueryDevtools initialIsOpen={false} />
  </QueryClientProvider>,
);
