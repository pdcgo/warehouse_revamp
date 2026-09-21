import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { MainSectionShell, description } from "./index";

const meta = {
  title: "Legacy/Pages/Shells/Main",
  component: MainSectionShell,
  parameters: { docs: { description: { component: description } } },
  args: { children: <Text data-testid="child">The selected screen renders here.</Text> },
} satisfies Meta<typeof MainSectionShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("section-shell")).toHaveAttribute("data-section", "Overview");
    await expect(canvas.getByTestId("child")).toBeVisible();
  },
};

// ⚠ THE TABS ARE REAL LINKS. These are the sections people send each other — tabs held in local
// state would produce a section nobody can link into, and every share would land the recipient on
// the first tab.
export const TabsAreRealLinks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("nav-tab-dashboard")).toHaveAttribute(
      "href",
      "/main/dashboard",
    );
  },
};
