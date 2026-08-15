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
  viteFinal: (cfg) => {
    cfg.plugins = [...(cfg.plugins ?? []), stubTransportPlugin()];

    return cfg;
  },
};

export default config;
