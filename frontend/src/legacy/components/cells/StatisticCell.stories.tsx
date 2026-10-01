import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { StatisticCell, description } from "./StatisticCell";

const meta = {
  title: "Legacy/Components/Cells/StatisticCell",
  component: StatisticCell,
  parameters: { docs: { description: { component: description } } },
  args: { value: 12_480, kind: "number" },
} satisfies Meta<typeof StatisticCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Count: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("statistic-cell")).toHaveTextContent("12.480");
  },
};

// RULE 1: it copies the RAW value. These are the columns people paste into a spreadsheet to
// reconcile, and "Rp 1,5jt" is exactly what a spreadsheet cannot accept.
export const PriceCopiesTheRawValue: Story = {
  args: { value: 1_500_000, kind: "price", compact: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("statistic-cell")).toHaveTextContent("Rp 1,5jt");

    await userEvent.click(canvas.getByTestId("statistic-cell"));
    await waitFor(async () => {
      await expect((window as unknown as { __copiedText?: string }).__copiedText).toBe("1500000");
    });
  },
};

// Duration shows the two largest units that fit. One throws away the precision the column is being
// read for; five is a number nobody can compare against the row below.
export const Duration: Story = {
  args: { value: 8_100, kind: "duration" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("statistic-cell")).toHaveTextContent("2h 15m");
  },
};

export const Percent: Story = { args: { value: 82.4, kind: "percent" } };

// RULE 2: a measure column is read by scanning DOWN it, which only works if the digits line up.
export const AColumnOfThem: Story = {
  render: () => (
    <Stack gap="0.5" w="160px">
      <StatisticCell value={1_000} />
      <StatisticCell value={8_888} />
      <StatisticCell value={112} />
      <StatisticCell value={94_321} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("statistic-cell")).toHaveLength(4);
  },
};
