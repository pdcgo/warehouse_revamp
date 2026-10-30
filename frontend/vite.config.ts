import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // PRE-BUNDLE THE CHARTS AT STARTUP. Only the analytic screen draws one, behind a lazy route, so the dev server first
  // met recharts mid-session, re-optimised its dependencies and served the page a stale chunk — the screen never
  // loaded until a restart (the e2e saw it). Named here, they are bundled before the first page is served.
  optimizeDeps: {
    include: ["recharts", "@chakra-ui/charts"],
  },
  server: {
    // strictPort: fail loudly on a collision rather than silently drifting to another
    // port (another project on this machine dev-serves on 5173).
    port: 5174,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Split the big, rarely-changing vendors into their own long-cached chunks so an app change
        // doesn't re-download React/Chakra, and no single chunk carries the whole world. The pages
        // themselves are code-split at the route (React.lazy in router.tsx).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@chakra-ui") || id.includes("@zag-js") || id.includes("@emotion")) {
            return "chakra";
          }
          if (id.includes("@connectrpc") || id.includes("@bufbuild")) return "connect";
          if (
            id.includes("react-dom") ||
            id.includes("react-router") ||
            id.includes("scheduler") ||
            id.includes("/react/")
          ) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
});
