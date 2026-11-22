import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The dependency cache — node_modules/.vite unless VITE_CACHE_DIR names another: each parallel e2e worker
  // (playwright.config.ts, `san test full --workers N`) gives its dev server its own, so they never rewrite one cache.
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
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
        //
        // ⚠ THE CHUNKS MUST NOT IMPORT EACH OTHER IN A CIRCLE (#128). Chakra v3 is built on Ark UI, whose package is
        // `@ark-ui/react` — a path holding "/react/". Matched by a loose `/react/` test it landed in the `react` chunk,
        // which then imported @zag-js from `chakra` while `chakra` imported React from `react`: whichever ran first
        // found the other undefined, and the production page drew blank ("reading 'createContext'"). So Ark UI goes
        // with Chakra, and the `react` chunk takes only the packages NAMED react, react-dom, react-router(-dom) and
        // scheduler — matched as whole package directories, never as a substring of another package's path.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](@chakra-ui|@ark-ui|@zag-js|@emotion)[\\/]/.test(id)) return "chakra";
          if (/[\\/]node_modules[\\/](@connectrpc|@bufbuild)[\\/]/.test(id)) return "connect";
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
});
