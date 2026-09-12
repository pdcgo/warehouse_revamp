import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { ProgressBar, description } from "./ProgressBar";

const meta = {
  title: "Legacy/Components/Feedback/ProgressBar",
  component: ProgressBar,
  parameters: { docs: { description: { component: description } } },
  args: { percent: 64, tone: "active" },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("progress-bar")).toHaveAttribute("data-percent", "64");
  },
};

// Over 100% is a REAL state — an account can exceed its ceiling — so the bar pins at full rather
// than painting wider than its own track. The number beside it carries the overage.
export const OverLimitClamps: Story = {
  args: { percent: 143, tone: "error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("progress-bar")).toHaveAttribute("data-percent", "100");
  },
};

export const Negative: Story = {
  args: { percent: -20 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("progress-bar")).toHaveAttribute("data-percent", "20");
  },
};

// The tone is what says whether "76% full" is fine or a problem — the same geometry, three readings.
export const TonesReadDifferently: Story = {
  render: () => (
    <Stack gap="3" w="280px">
      <ProgressBar percent={38} tone="success" />
      <ProgressBar percent={76} tone="warning" />
      <ProgressBar percent={96} tone="error" />
    </Stack>
  ),
};
