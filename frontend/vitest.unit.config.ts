import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// THE PLAIN UNIT TESTS — pure helpers (`src/**/*.test.ts`) in Node, no browser and no Storybook. The story run
// (vitest.config.ts) is the other layer: a real Chromium rendering stories.
//
//   npm run test:unit
export default defineConfig({
  test: {
    name: "unit",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  cacheDir: fileURLToPath(new URL("./node_modules/.vite-vitest-unit", import.meta.url)),
});
