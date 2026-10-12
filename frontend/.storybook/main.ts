import type { StorybookConfig } from "@storybook/react-vite";

// The .ts extension is required — Storybook loads this file as native ESM, where an extensionless
// relative import does not resolve.
import { stubTransportPlugin } from "./stubTransportPlugin.ts";

const config: StorybookConfig = {
  // Stories live BESIDE the component they document, the same way a Go handler's unit test does.
  // A parallel `stories/` tree is the arrangement that lets a component be changed without anyone
  // noticing its story no longer matches.
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // The gallery this replaced was hand-written prose; autodocs generates the same page from the
  // component's own props and its `description`, so it cannot drift from the code.
  docs: { defaultName: "Docs" },
  // ⚠ KNOWN, UNFIXED, and cosmetic: the manager auto-detects a composed Storybook from any dependency
  // whose package.json carries a `storybook` field. `@chakra-ui/react` has one, so every page load
  // fetches https://storybook.chakra-ui.com and fails CORS — two console errors and a dead "Chakra UI"
  // entry in the sidebar. Neither `refs: {}` nor `refs: () => ({})` suppresses it on Storybook 10.5;
  // both were tried and verified not to work, so neither is left here pretending to.
  viteFinal: (cfg) => {
    cfg.plugins = [...(cfg.plugins ?? []), stubTransportPlugin()];

    return cfg;
  },
};

export default config;
