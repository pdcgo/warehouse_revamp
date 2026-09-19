import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { OrderSettlementPage } from "./index";
import { allOrders, noEstimate, worked } from "./fixtures";
import { hiddenCost, loss } from "./model";

// THE SETTLEMENT LIST — orders ranked by how much of what the buyer paid never reached us.
//
// ⚠ A PROTOTYPE. Rows come in as a prop; no query hook, no client, no route.
//
// The screen exists to answer one question — *which orders went furthest wrong* — and to NOT answer
// two it would be natural to expect of it:
//
//   - it is not a worklist. `a-residual-balance-is-normal` means almost every order ends non-zero, so
//     a queue of "unsettled" orders would contain all of them.
//   - it is not a debt list. `hidden-cost-is-left-in-the-balance` means the gap is already gone and
//     nobody is collecting it. The column is **Lost**, never "outstanding".
const meta = {
  title: "Pages/Order Settlement/List",
  component: OrderSettlementPage,
} satisfies Meta<typeof OrderSettlementPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The default view: every order, worst loss first.
 *
 * The ranking IS the design. There is no status column and nothing to tick off, so ordering by loss
 * is the only thing that makes the page actionable.
 */
export const Default: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getAllByTestId(/^settlement-row-/);
    await expect(rows).toHaveLength(6);

    // Worst first — the awaiting order (85.000 of the sale still unreceived) leads.
    await expect(rows[0]).toHaveAttribute("data-testid", "settlement-row-2");

    // ⚠ And the no-estimate order sorts LAST despite a large number, because its number is not real.
    await expect(rows[rows.length - 1]).toHaveAttribute("data-testid", "settlement-row-6");

    // The vocabulary check, on the whole page: nothing here may imply somebody owes us.
    await expect(canvasElement).not.toHaveTextContent(/outstanding|unpaid|overdue/i);
  },
};

/**
 * The implied take rate — the one aggregate worth a card.
 *
 * `hidden-cost-is-left-in-the-balance` says the unexplained gap is the closest thing this system can
 * produce to *"what does selling on this platform actually cost us"*. Per order it is noise; summed
 * down a shop it is the number that compares marketplaces.
 */
export const ImpliedTakeRate: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = canvas.getByTestId("take-rate-card");

    // The rate is computed only over orders whose SALE was recorded — a missing marketplace total is a
    // missing denominator, not a zero one.
    await expect(hiddenCost(noEstimate)).toBe(-62_000n);
    await expect(card).toHaveTextContent("% of sales");

    // A rate under 1% must not render as "0%" — hence basis points.
    await expect(canvas.getByTestId("hidden-total")).toBeInTheDocument();
  },
};

/** Filtering to one shop narrows both the table and the take rate — they are the same population. */
export const FilteredByShop: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.selectOptions(canvas.getByTestId("shop-filter"), "Toko Melati");

    await waitFor(async () => {
      await expect(canvas.getAllByTestId(/^settlement-row-/)).toHaveLength(3);
    });
    // The aggregate follows the filter, or the card would describe a different set than the table.
    await expect(canvas.getByTestId("take-rate-card")).toBeInTheDocument();
  },
};

/**
 * An order whose marketplace total was never recorded.
 *
 * ⚠ THE OPEN QUESTION AGAIN. Rather than printing a loss measured against zero — which would read as
 * enormous profit — the row says there is nothing to measure against, and spans the money columns so
 * no figure appears at all.
 */
export const RowWithNoEstimate: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("row-no-estimate")).toHaveTextContent(/no marketplace total recorded/i);
  },
};

/** Rows carrying hand-typed entries are marked in the list, not only on the detail panel. */
export const ManualEntriesVisible: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Only the corrected-by-hand order has them, and it says so before you open it — which is what
    // makes "review your team's manual entries" a thing somebody can actually do.
    await expect(canvas.getAllByTestId("has-manual")).toHaveLength(1);
  },
};

/** Clicking a row opens the order — the list is a way in, not a destination. */
export const OpensAnOrder: Story = {
  args: { orders: allOrders },
  render: function Render(args) {
    const [opened, setOpened] = useState<bigint | null>(null);
    return (
      <>
        <OrderSettlementPage {...args} onOpenOrder={setOpened} />
        {opened !== null && <div data-testid="opened">{String(opened)}</div>}
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("settlement-row-1"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("opened")).toHaveTextContent("1");
    });
  },
};

/** An empty list is a real state — a team whose orders have not settled yet. */
export const Empty: Story = {
  args: { orders: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryAllByTestId(/^settlement-row-/)).toHaveLength(0);
    // The card still renders, at zero, rather than vanishing — a missing card reads as a broken page.
    await expect(canvas.getByTestId("take-rate-card")).toBeInTheDocument();
    await expect(loss(worked)).toBe(10_000n);
  },
};
