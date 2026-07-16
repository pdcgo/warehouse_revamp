import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChakraProvider } from "@chakra-ui/react";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import "./i18n/config";
import { Toaster } from "./components/Toaster";
import { router } from "./router";
import { system } from "./theme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChakraProvider value={system}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </ChakraProvider>
  </StrictMode>,
);
