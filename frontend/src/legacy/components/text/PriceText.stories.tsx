import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { PriceText, description } from "./PriceText";

const meta = {
  title: "Legacy/Components/Text/PriceText",
  component: PriceText,
  parameters: { docs: { description: { component: description } } },
  args: { amount: 1_500_000n },
} satisfies Meta<typeof PriceText>;

export default meta;
type Story = StoryObj<typeof meta>;

// Above the threshold: compacted, and the EXACT amount is in the tooltip. Compacting without that
// tooltip would be a screen that quietly rounds the numbers people reconcile against.
export const CompactedKeepsTheExactValue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const el = canvas.getByTestId("price-text");

    await expect(el).toHaveAttribute("data-compact", "true");
    await expect(el).toHaveTextContent("Rp 1,5jt");

    await userEvent.hover(el);
    await waitFor(async () => {
      await expect(screen.getByTestId("tooltip-content")).toHaveTextContent("Rp 1.500.000");
    });
  },
};

// Below the threshold: shown in full, and NO tooltip — the exact value is already on screen, so a
// tip repeating it is noise.
export const SmallAmountIsExactAndUntipped: Story = {
  args: { amount: 7_500n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const el = canvas.getByTestId("price-text");

    await expect(el).toHaveAttribute("data-compact", "false");
    await expect(el).toHaveTextContent("Rp 7.500");

    await userEvent.hover(el);
    await new Promise((r) => setTimeout(r, 350));
    await expect(screen.queryByTestId("tooltip-content")).toBeNull();
  },
};

export const Negative: Story = { args: { amount: -2_400_000n } };

export const Billions: Story = { args: { amount: 3_250_000_000n } };

export const Zero: Story = { args: { amount: 0n } };
