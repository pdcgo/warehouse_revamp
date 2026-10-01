import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
