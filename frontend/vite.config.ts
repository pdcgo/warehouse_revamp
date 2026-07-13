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
});
