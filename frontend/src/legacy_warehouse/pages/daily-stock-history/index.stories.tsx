import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { STOCK_DAYS } from "../../fixtures";
import { DailyStockPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/DailyStockHistory",
  component: DailyStockPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: STOCK_DAYS },
} satisfies Meta<typeof DailyStockPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("balance-check")).toHaveLength(5);
  },
};

// ⚠ THE ROW MUST BALANCE, AND THE SCREEN CHECKS IT. This is a ledger, not an activity report, and
// its entire value is in being checkable — a reader hunting the bad day should not have to do the
// arithmetic themselves.
export const EveryRowIsCheckedArithmetically: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const checks = canvas.getAllByTestId("balance-check");
    await expect(checks.every((c) => c.getAttribute("data-balances") === "true")).toBe(true);
  },
};

// ⚠ AN ADJUSTMENT IS THE ADMISSION THAT SOMETHING HAPPENED OFF-LEDGER — the only column with no
// physical movement behind it, so it is the one to look at first and it is marked.
export const AdjustmentsAreMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const adjustments = canvas.getAllByTestId("adjustment");
    await expect(adjustments).toHaveLength(1);
    await expect(adjustments[0]).toHaveTextContent("-2");
  },
};

// A day with no adjustment renders a dash, not a zero. Zero and "nothing happened" read the same in
// a column of numbers, and only one of them is worth a second look.
export const NoAdjustmentIsADashNotAZero: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByText("—").length).toBeGreaterThan(0);
  },
};

// ⚠ A ROW THAT DOES NOT BALANCE IS EITHER A BUG OR AN UNRECORDED MOVEMENT, and both are worth
// stopping for — so it is stated in words rather than shown as a subtle colour.
export const ABrokenRowSaysSoInWords: Story = {
  args: {
    rows: [
      // 100 + 0 − 5 + 0 = 95, and the recorded close is 90. Five units left the building with
      // nothing recording it.
      { ...STOCK_DAYS[0], opening: 100, inbound: 0, outbound: 5, adjustment: 0, closing: 90 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const check = canvas.getByTestId("balance-check");
    await expect(check).toHaveAttribute("data-balances", "false");
    await expect(check).toHaveTextContent("does not balance");
  },
};

// The reason for an adjustment is on another screen, and the screen says so rather than leaving the
// reader to wonder where it went.
export const ItPointsAtWhereTheReasonLives: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("daily-stock-page")).toHaveTextContent("Problem items");
  },
};

export const NoMovement: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("stock-history-table")).toHaveTextContent("No movement recorded");
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };
