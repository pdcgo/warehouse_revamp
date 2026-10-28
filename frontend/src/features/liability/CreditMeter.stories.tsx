import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { CreditMeter } from "./CreditMeter";

// HOW MUCH OF A LIMIT IS USED, and the 80% warning (the-threshold-warns-at-eighty-percent). Read by BOTH sides of a
// pair: the creditor on its Terms tab, worded as its own ("Near limit"), and the debtor on the pair detail, worded
// from the side the limit is set ON (the-debtor-sees-the-limits-set-on-it).

const meta = {
  title: "Features/Liability/CreditMeter",
  component: CreditMeter,
  args: { limit: 10_000_000n, debt: 8_700_000n, testId: "meter" },
} satisfies Meta<typeof CreditMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

// The creditor's own view — unchanged by the debtor's wording.
export const TheCreditorsView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("meter-pct")).toHaveTextContent("87%");
    await expect(canvas.getByTestId("meter-warn")).toHaveTextContent("Near limit");
  },
};

// The debtor's view: the same badge at the same threshold, naming who set the limit.
export const TheDebtorsView: Story = {
  args: { setBy: "Toko Anggrek" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("meter-warn")).toHaveTextContent("87% of the limit Toko Anggrek set");
  },
};

// At the limit, from the debtor's side — the next order drawing on this creditor is refused.
export const TheDebtorAtTheLimit: Story = {
  args: { setBy: "Toko Anggrek", limit: 1_000_000n, debt: 1_000_000n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("meter-warn")).toHaveTextContent("100% of the limit Toko Anggrek set — the next order is refused");
  },
};

// Below 80% there is no badge on either side — the warning is a warning, not a decoration.
export const BelowTheThreshold: Story = {
  args: { setBy: "Toko Anggrek", limit: 2_000_000n, debt: 400_000n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("meter-pct")).toHaveTextContent("20%");
    await expect(canvas.queryByTestId("meter-warn")).toBeNull();
  },
};

// ⚠ FROZEN IS WORDS, NOT A PERCENTAGE — and from the debtor's side it names who froze it.
export const FrozenFromTheDebtorsSide: Story = {
  args: { setBy: "Gudang Pusat", limit: 0n, debt: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("meter")).toHaveTextContent("Gudang Pusat allows you no credit");
  },
};

// ⚠ UNLIMITED IS WORDS, NOT A FULL BAR.
export const Unlimited: Story = {
  args: { setBy: "Gudang Cabang", limit: undefined, debt: 860_000n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("meter")).toHaveTextContent("Unlimited");
  },
};
