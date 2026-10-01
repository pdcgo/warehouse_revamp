import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { OrderDetailPreview } from "./components/OrderDetailPreview";
import { worked, awaiting } from "./fixtures";

// THE ORDER DETAIL PAGE, WITH THE SETTLEMENT TAB — `context.md` §What Frontend Expected 1.
//
// ⚠ A PREVIEW SHELL, not the shipped page. `pages/order-detail/index.tsx` is live on
// `/orders/:orderId`; adding a fixture-fed tab to it before `design_accept` would show invented money
// on real orders. Info and Timeline here are the REAL components, so this is the actual page with one
// tab added — see the header of `components/OrderDetailPreview.tsx`.
//
// What this story answers that the standalone Ledger Panel story cannot: does the settlement tab
// still make sense BESIDE the order it belongs to — and do the two screens agree about the sale?
const meta = {
  title: "Pages/Order Settlement/On Order Detail",
  component: OrderDetailPreview,
} satisfies Meta<typeof OrderDetailPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * §Settlement Behaviors, on the page where a person would actually meet it.
 *
 * Three tabs, settlement open: the order lost 10.000 of the 120.000 the buyer paid, and 20.000 of
 * that was never itemised by anyone.
 */
export const Default: Story = {
  args: { settlement: worked, canPost: true, today: "2026-01-10" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("preview-tab-info")).toBeInTheDocument();
    await expect(canvas.getByTestId("preview-tab-timeline")).toBeInTheDocument();
    await expect(canvas.getByTestId("preview-tab-settlement")).toBeInTheDocument();

    // The settlement tab opens first — it is the one under review.
    await expect(canvas.getByTestId("order-ledger-panel")).toBeVisible();
  },
};

/**
 * THE TWO TABS MUST AGREE ABOUT THE SALE.
 *
 * `the-sale-is-recorded-once-and-copied-verbatim`: `initial_total` is a frozen copy of
 * `order.marketplace_total`. So the figure the Info tab prints and the figure every loss on the
 * Settlement tab is measured against are the same number seen twice — and a disagreement between
 * them is the single most damaging thing this design can get wrong, because every derived figure
 * inherits it.
 *
 * ⚠ This is the assertion that would catch the reversal of that decision.
 */
export const MarketplaceTotalMatches: Story = {
  args: { settlement: worked, canPost: true, today: "2026-01-10" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Settlement side: the sale it opened the account from.
    await expect(canvas.getByTestId("order-ledger-panel")).toHaveTextContent("Rp 120.000");

    await userEvent.click(canvas.getByTestId("preview-tab-info"));
    await waitFor(async () => {
      await expect(canvas.getByText(/Total order di marketplace/i)).toBeVisible();
    });

    // Order side: the same number, printed by the shipped InfoPanel from `order.marketplaceTotal`.
    await expect(canvasElement).toHaveTextContent(/Total order di marketplace: Rp 120\.000/i);
  },
};

/**
 * ADDING AN ENTRY FROM THE ORDER PAGE — the sentence in §What Frontend Expected, end to end.
 *
 * ⚠ The dialog PORTALS, so it is queried through `screen`; the page around it stays in `canvas`.
 */
export const AddsFromTheOrderPage: Story = {
  args: { settlement: worked, canPost: true, today: "2026-01-10" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("add-entry"));

    const amount = await screen.findByTestId("entry-amount");
    await userEvent.type(amount, "5000", { delay: 20 });
    await userEvent.click(screen.getByTestId("direction-out"));
    await userEvent.click(screen.getByTestId("entry-submit"));

    await waitFor(async () => {
      await expect(canvas.getByTestId("preview-draft")).toHaveTextContent(
        "marketplace_adjustment:-5000:2026-01-10",
      );
    });
  },
};

/**
 * NO ADD BUTTON WITHOUT THE RIGHT TO POST.
 *
 * §Access Role is still open, so the page cannot decide who may write — but it can be built so that
 * the answer has exactly one place to land. `canPost` is that place, and it is the caller's.
 */
export const ReadOnlyViewer: Story = {
  args: { settlement: worked, canPost: false, today: "2026-01-10" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("add-entry")).not.toBeInTheDocument();
    // The ledger itself still reads — the role gates writing, never looking.
    await expect(canvas.getByTestId("ledger-table")).toBeVisible();
  },
};

/**
 * A SHIPPED ORDER WITH NOTHING PAID YET.
 *
 * `settlement-ignores-our-order-status` — the order is finished and the account is untouched, and
 * nothing on either tab treats that as an error. This is the state most orders on the page are in.
 */
export const NothingArrivedYet: Story = {
  args: { settlement: awaiting, canPost: true, today: "2026-01-10" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("loss")).toHaveTextContent("Rp 85.000");
    await expect(canvas.getByTestId("ledger-table")).toBeVisible();
  },
};
