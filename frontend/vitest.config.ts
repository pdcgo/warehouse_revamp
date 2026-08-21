import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { stubTransportPlugin } from "./.storybook/stubTransportPlugin";

// The story test run.
//
// Every story is a test: Vitest renders it in a real Chromium through the browser provider and runs
// its `play()` function as the test body. That is why the assertions live in the story rather than in
// a separate spec — one definition is both the thing a person reviews in the sidebar and the thing
// CI fails on.
//
// It is a REAL BROWSER on purpose, not jsdom. Chakra's controls are built on Ark/zag state machines
// that measure elements, and a combobox popover positioned by Floating UI has no size in jsdom — the
// picker stories would pass or fail on layout the user never sees.
//
// This is a different layer from Playwright (`npm run e2e`), and does not replace it: e2e drives the
// whole app against a real Go server and a real Postgres, while this pins ONE component's behaviour
// with the API stubbed. A regression in RackSelect should fail here, in a second, naming the
// component — not as a mysterious timeout in an order-flow spec.
export default defineConfig({
  plugins: [
    react(),
    stubTransportPlugin(),
    storybookTest({ configDir: ".storybook", storybookScript: "npm run storybook" }),
  ],
  test: {
    name: "storybook",
    // No setup file: since Storybook 10.3 the addon applies `.storybook/preview.tsx`'s decorators,
    // globals and `beforeEach` to the test run itself. A hand-written `setProjectAnnotations` here
    // is not just redundant, it is IGNORED — the addon detects one and skips its own provisioning,
    // so a stale copy would be the thing deciding what the tests render.
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
  cacheDir: fileURLToPath(new URL("./node_modules/.vite-vitest", import.meta.url)),
});
