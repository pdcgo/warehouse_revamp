import type { Meta, StoryObj } from "@storybook/react-vite";
import { PackageCheck } from "lucide-react";
import { expect, within } from "storybook/test";

import { OverviewCard, description } from "./OverviewCard";

const ROWS = [
  { state: "Awaiting processing", orders: 34, units: 71 },
  { state: "Being picked", orders: 12, units: 28 },
  { state: "Packed", orders: 51, units: 130 },
  { state: "Handed to courier", orders: 103, units: 244 },
  { state: "Cancelled", orders: 9, units: 17, cancelled: true },
];

const meta = {
  title: "LegacyWarehouse/Components/Display/OverviewCard",
  component: OverviewCard,
  parameters: { docs: { description: { component: description } } },
  args: { title: "Outbound today", icon: PackageCheck, rows: ROWS, colorPalette: "green" },
} satisfies Meta<typeof OverviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// ⚠ THE TOTAL EXCLUDES CANCELLED, AND SAYS SO ON THE CARD. The exclusion is right — the card answers
// "how much work is there today" and a cancellation is not work — but an unexplained total that does
// not equal the visible rows reads as a bug, and someone eventually "fixes" it.
export const CancelledIsExcludedAndExplained: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const total = canvas.getByTestId("overview-total");
    // 34 + 12 + 51 + 103 = 200. The nine cancelled orders are visible but not counted.
    await expect(total).toHaveTextContent("200");
    await expect(total).toHaveTextContent("Cancelled not counted");

    // The cancelled row is still shown — hiding it would lose a real number.
    await expect(canvas.getAllByTestId("overview-row")).toHaveLength(5);
  },
};

// A share column only makes sense against the same total, so the cancelled row gets a dash rather
// than a percentage of a total it is not part of.
export const CancelledHasNoShare: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const rows = canvas.getAllByTestId("overview-row");
    await expect(rows[4]).toHaveTextContent("—");
    await expect(rows[3]).toHaveTextContent("52%");
  },
};

// Nothing moved yet today. The card still renders its states, so an operator can tell "no work" from
// "the screen did not load".
export const NothingYet: Story = {
  args: {
    rows: [
      { state: "Awaiting processing", orders: 0, units: 0 },
      { state: "Packed", orders: 0, units: 0 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("overview-total")).toHaveTextContent("0");
    await expect(canvas.getAllByTestId("overview-row")).toHaveLength(2);
  },
};

export const Loading: Story = { args: { loading: true } };
