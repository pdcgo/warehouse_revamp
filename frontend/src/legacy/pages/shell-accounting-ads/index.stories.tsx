import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { AccountingAdsSectionShell, description } from "./index";

const meta = {
  title: "Legacy/Pages/Shells/AccountingAds",
  component: AccountingAdsSectionShell,
  parameters: { docs: { description: { component: description } } },
  args: { children: <Text data-testid="child">The selected screen renders here.</Text> },
} satisfies Meta<typeof AccountingAdsSectionShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("section-shell")).toHaveAttribute("data-section", "Advertising");
    await expect(canvas.getByTestId("child")).toBeVisible();
  },
};

// ⚠ THE TABS ARE REAL LINKS. These are the sections people send each other — tabs held in local
// state would produce a section nobody can link into, and every share would land the recipient on
// the first tab.
export const TabsAreRealLinks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("nav-tab-list")).toHaveAttribute(
      "href",
      "/accounting/ads/list",
    );
  },
};

// The shell marks which child is current, so a deep link arrives with the right tab lit.
export const SecondTabSelected: Story = {
  args: { active: "daily" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("nav-tab-daily")).toHaveAttribute("aria-selected", "true");
  },
};
