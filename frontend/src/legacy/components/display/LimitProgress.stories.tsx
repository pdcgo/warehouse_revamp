import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { LimitProgress, description } from "./LimitProgress";

const meta = {
  title: "Legacy/Components/Display/LimitProgress",
  component: LimitProgress,
  parameters: { docs: { description: { component: description } } },
  args: { unpaid: 32_000_000n, threshold: 50_000_000n, showValue: true, showIcon: true },
} satisfies Meta<typeof LimitProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("limit-progress")).toHaveAttribute("data-status", "ok");
  },
};

// The thresholds are POLICY and live in the component, once — 80% "start collecting", 100% "stop
// shipping". If every screen picked its own, the same account would read as fine in one place and
// urgent in another.
export const TheThreeStatuses: Story = {
  render: () => (
    <Stack gap="4" w="320px">
      <LimitProgress unpaid={20_000_000n} threshold={50_000_000n} showValue showIcon />
      <LimitProgress unpaid={44_000_000n} threshold={50_000_000n} showValue showIcon />
      <LimitProgress unpaid={58_000_000n} threshold={50_000_000n} showValue showIcon />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bars = canvas.getAllByTestId("limit-progress");

    await expect(bars[0]).toHaveAttribute("data-status", "ok");
    await expect(bars[1]).toHaveAttribute("data-status", "warning");
    await expect(bars[2]).toHaveAttribute("data-status", "danger");
  },
};

// ⚠ A ZERO THRESHOLD IS "NO LIMIT CONFIGURED", NOT A FULL BAR. Dividing by it gives Infinity, and
// rendering it as 100% would read as an account that had maxed out — close to the opposite of the
// truth. It gets its own quiet chip instead.
export const NoLimitSetIsNotAFullBar: Story = {
  args: { threshold: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("limit-progress-inactive")).toHaveTextContent("No limit set");
    await expect(canvas.queryByTestId("limit-progress")).toBeNull();
  },
};

// Over the ceiling is a REAL state: the bar pins at full and the percentage carries the overage.
export const OverTheLimit: Story = { args: { unpaid: 71_000_000n, threshold: 50_000_000n } };

export const Compact: Story = { args: { showValue: false, showIcon: false } };
