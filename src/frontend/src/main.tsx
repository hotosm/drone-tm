// HOT theme only (fonts + design tokens + WebAwesome overrides)
// WebAwesome base CSS is loaded via CDN in index.html for cross-tool caching
import "@hotosm/ui/dist/style-core.css";

import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PersistGate } from "redux-persist/integration/react";
import "@Assets/css/index.css";
import "@Assets/css/tailwind.css";
import { store, persistor } from "./store";
import App from "./App";
import { getRuntimeConfig } from "./runtimeConfig";

// Workaround required, as @hotosm/gcp-editor already imports all components
if (!customElements.get("hot-tracking")) {
  import("@hotosm/ui/dist/hotosm-ui.js");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <Provider store={store}>
      <PersistGate loading={<h1>hello</h1>} persistor={persistor}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        {window.location.hostname === "drone.hotosm.org" && (
          <hot-tracking
            style={{ position: "fixed", bottom: "0%" }}
            site-id="35"
            domain="drone.hotosm.org"
          />
        )}
      </PersistGate>
    </Provider>
    <ReactQueryDevtools initialIsOpen={false} />
  </QueryClientProvider>,
);
