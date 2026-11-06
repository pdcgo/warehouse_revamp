import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { HStack } from "@chakra-ui/react";

import { formatUnixDate } from "../../lib/datetime";
import { ShopStatusBadge, description } from "./ShopStatusBadge";

// A closed shop's badge (a-shop-is-closed-never-deleted). Its uses are pinned on the
// screens in `pages/shops/CloseShop.stories.tsx`; here, its two readings.

const THREE_DAYS_AGO = BigInt(Math.floor((Date.now() - 3 * 24 * 3600 * 1000) / 1000));

const meta = {
  title: "Features/Shops/ShopStatusBadge",
  component: ShopStatusBadge,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof ShopStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed alone — a picker's option, the title of a shop's page. */
export const Closed: Story = {
  args: { testId: "badge" },
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByTestId("badge");
    await expect(badge).toHaveTextContent(/^Closed$/);
    // Gray, the plain tone — closed is a state, not a warning.
    await expect(badge.getAttribute("class") ?? "").not.toMatch(/warning|error|orange|red/);
    await expect(badge.querySelector("svg")).not.toBeNull();
  },
};

/** With the day it closed — under a shop's name on the list. */
export const ClosedOnADay: Story = {
  args: { testId: "badge", closedAtUnix: THREE_DAYS_AGO },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("badge")).toHaveTextContent(`Closed · ${formatUnixDate(THREE_DAYS_AGO)}`);
  },
};

/** The sizes it is drawn at — `xs` on a picker's option, `sm` elsewhere. */
export const Sizes: Story = {
  render: () => (
    <HStack gap="3">
      <ShopStatusBadge size="xs" testId="xs" />
      <ShopStatusBadge size="sm" testId="sm" closedAtUnix={THREE_DAYS_AGO} />
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("xs").getBoundingClientRect().height).toBeLessThan(
      canvas.getByTestId("sm").getBoundingClientRect().height + 1,
    );
  },
};
