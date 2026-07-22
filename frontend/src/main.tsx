import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import "./i18n/config";
import { queryClient } from "./api/queryClient";
import { Toaster } from "./components/Toaster";
import { router } from "./router";
import { system } from "./theme";

// QueryClientProvider sits OUTSIDE AuthProvider (#174): AuthProvider's first act is a CheckAccess on
// page load, so a cache has to exist before it runs for that call ever to become a query. Nesting it
// the other way round would leave the one request that gates the whole app as the only one outside
// the cache.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChakraProvider value={system}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ChakraProvider>
  </StrictMode>,
);
