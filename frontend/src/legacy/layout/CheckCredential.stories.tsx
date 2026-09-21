import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { CheckCredential, description } from "./CheckCredential";

const meta = {
  title: "Legacy/Layout/CheckCredential",
  component: CheckCredential,
  parameters: { docs: { description: { component: description } } },
  args: { children: <Text data-testid="app">The app</Text> },
} satisfies Meta<typeof CheckCredential>;

export default meta;
type Story = StoryObj<typeof meta>;

// While the session resolves, the shell is held back — otherwise the nav draws with no role and
// then visibly GROWS as roles arrive, which reads as the app deciding in front of you what you may
// do (and is long enough on a slow connection to start clicking a menu that is about to change).
export const Checking: Story = {
  args: { checking: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("check-credential")).toBeVisible();
    await expect(canvas.queryByTestId("app")).toBeNull();
  },
};

// Settled: it adds NOTHING to the tree — no wrapper, no extra Box. A gate that left a container
// behind would change the layout of every page it wrapped.
export const SettledAddsNothing: Story = {
  args: { checking: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("app")).toBeVisible();
    await expect(canvas.queryByTestId("check-credential")).toBeNull();
  },
};
