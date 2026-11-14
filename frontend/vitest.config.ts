import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { cacheModulesForTheRun } from "./.storybook/runCachePlugin";
import { stubTransportPlugin } from "./.storybook/stubTransportPlugin";

// The browser server's port: 6106, or STORIES_BROWSER_PORT — `san test full` gives its frozen copy's Storybook run a
// port of its own (6116+, docs/tools/san.md#test-full) so a Storybook run in the live tree, on 6106, never meets it:
// two runs on one port have had one's test browser load the other's files. (vitest's --browser.api.port flag does not
// reach this server — it reads this file.)
function browserPort(): number {
  const raw = process.env.STORIES_BROWSER_PORT;
  if (raw === undefined || raw === "") return 6106;

  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port >= 49152) {
    throw new Error(`STORIES_BROWSER_PORT=${raw}: want a port below 49152 (see the note on api.port)`);
  }

  return port;
}

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
    // One run's modules are cached by the test browser — without it a full run's tab hits Chromium's request cap
    // (net::ERR_INSUFFICIENT_RESOURCES) and the run stops early. Why, and when it stays off: the plugin's file.
    cacheModulesForTheRun(),
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
      // ⚠ REDUCED MOTION. The theme collapses every animation and transition to nothing for a device that asks
      // (`motion-is-small-quick-and-shared`), and the test browser asks. A story reads computed styles — a row's
      // background under `data-hover`, an element's visibility — and mid-transition those are neither the old value
      // nor the new one, so a test would pass or fail on timing. Motion is reviewed by eye in Storybook, not asserted.
      provider: playwright({ contextOptions: { reducedMotion: "reduce" } }),
      instances: [{ browser: "chromium" }],
      // ⚠ PINNED, and BELOW 49152. Vitest's default (63315) sits inside a TCP range Windows reserves for
      // Hyper-V/WinNAT (`netsh interface ipv4 show excludedportrange protocol=tcp`), so the run dies on
      // startup with "listen EACCES ::1:63315" before any story executes. Those reservations are carved out
      // of the DYNAMIC range (49152+) and MOVE every time Docker or Hyper-V starts — the earlier pin, 51234,
      // was outside them one day and inside 51170–51269 the next. A port under 49152 can never be reserved
      // that way. 6106 sits beside Storybook's 6006; a full run's frozen copy uses its own (browserPort above).
      api: { port: browserPort() },
    },
  },
  // ⚠ Not where the deps go: @storybook/addon-vitest sets its own cacheDir over this one —
  // node_modules/.cache/storybook/<version>/<hash of the config dir>/sb-vitest (deps/, and vitest/results.json).
  cacheDir: fileURLToPath(new URL("./node_modules/.vite-vitest", import.meta.url)),
});
