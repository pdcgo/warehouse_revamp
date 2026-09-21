import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { DateCell, description } from "./DateCell";

const FIXED = 1_785_000_000n;

const meta = {
  title: "Legacy/Components/Cells/DateCell",
  component: DateCell,
  parameters: { docs: { description: { component: description } } },
  args: { value: FIXED },
} satisfies Meta<typeof DateCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DateTime: Story = {};

// The grain is a per-COLUMN decision. Showing "01 Aug 2026, 00:00" on a monthly settlement row is
// three pieces of false precision; showing only the day on a stock movement loses the one thing
// that distinguishes two movements on the same morning.
export const EveryGrain: Story = {
  render: () => (
    <Stack gap="1">
      <DateCell value={FIXED} grain="datetime" />
      <DateCell value={FIXED} grain="date" />
      <DateCell value={FIXED} grain="month" />
      <DateCell value={FIXED} grain="year" />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cells = canvas.getAllByTestId("date-cell");

    await expect(cells).toHaveLength(4);
    // The coarsest grain is the year alone — not a truncated timestamp.
    await expect(cells[3]).toHaveTextContent(/^\d{4}$/);
  },
};

export const Relative: Story = {
  args: { value: BigInt(Math.floor(Date.now() / 1000) - 7200), grain: "relative" },
};

// "No date" is a real state and renders as the app's em dash — never as "Invalid Date".
export const NoDate: Story = {
  args: { value: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("date-cell")).toHaveTextContent("—");
  },
};
