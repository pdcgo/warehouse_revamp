import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { CANCELLED, FULL, ORDER_DETAIL_META, Routed } from "./kit";

// ONE ORDER — the two totals, and the settlement ledger.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderDetailPage/Money",
  ...ORDER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * TWO TOTALS, TWO FACTS — and they disagree on purpose.
 *
 * `total_cost` is what the order cost US (goods + the warehouse's fee); `platform_total` is what the BUYER PAID THE
 * PLATFORM. Settlement opens every order's account from the platform figure and never from ours, so a fixture where
 * the two matched would make every downstream screen look correct by accident.
 *
 * ⚠ This is the number the settlement design is built on — see
 * `pages/order-settlement/components/OrderDetailPreview.tsx`, which asserts the same figure reaches
 * the settlement tab unchanged.
 */
export const PlatformTotalDiffersFromOurs: Story = {
  name: "Two totals",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("summary-tiles")).toBeInTheDocument());

    // Two facts on two tiles: what the platform paid, and what the order cost us (goods + fee). The
    // list shows the same pair (`the-row-shows-total-beli-and-total-mp`).
    await expect(Number(FULL.platformTotal)).not.toBe(FULL.totalCost);
    await expect(canvas.getByTestId("tile-mp")).toHaveTextContent("Rp 245.000");
    await expect(canvas.getByTestId("tile-system")).toHaveTextContent("Rp 150.500");

    // The tile is LABELLED, in the decided word (platform-is-the-word-for-the-outside-marketplace) — never the raw
    // key i18next prints for a key its catalog lacks, as it once did for `orderDetail.money.platformTotal`.
    await expect(canvas.getByTestId("tile-mp")).toHaveTextContent("Platform total");

    // …and no label anywhere on the page is a key: not the text, not a tooltip (the margin bar's title), not an
    // aria-label.
    const rawKey = /\b(orderDetail|orders|orderForm|common)\.[a-z][A-Za-z]+/;
    const labels = [
      canvasElement.textContent ?? "",
      ...Array.from(canvasElement.querySelectorAll("[title], [aria-label]")).map(
        (el) => `${el.getAttribute("title") ?? ""} ${el.getAttribute("aria-label") ?? ""}`,
      ),
    ];
    await expect(labels.filter((label) => rawKey.test(label))).toEqual([]);
  },
};

/**
 * THE SETTLEMENT LEDGER IN ITS REAL SEAT — a section of the order, as it was a tab of it.
 *
 * `order-detail-manages-the-ledger` put it here rather than on a screen of its own: the ledger is a
 * property OF an order, and the person adding a row is looking at that order.
 *
 * This pins the tab against the settlement design's own WORKED example, so the numbers on screen are
 * the ones the design was reviewed with — the buyer paid 120.000, part of it never arrived, and the
 * gap is the platform's take rather than a debt anybody will collect.
 */
export const SettlementLedger: Story = {
  name: "Settlement ledger",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("section-settlement")).toBeInTheDocument());

    // The panel loads from the real query hook through the stubbed transport — not a prop — so this
    // also proves the adapter maps the wire enums back to the shapes the panel was designed against.
    await waitFor(() => {
      expect(canvas.queryByTestId("settlement-absent")).not.toBeInTheDocument();
    });

    await waitFor(async () => {
      await expect(canvasElement).toHaveTextContent("120.000");
    });
  },
};

// 107 is CANCELLED and has no settlement account in the stub — the "never settled" case.
const AtCancelledOrder = Routed(`/orders/${CANCELLED.id}`);

/**
 * ⚠ NEVER SETTLED IS NOT SETTLED TO ZERO.
 *
 * The service answers NotFound for an order with no account, and the tab must SAY so. A zeroed panel
 * would read as a completed settlement nobody performed — the one reading that is worse than showing
 * nothing, because it looks like an answer.
 */
export const SettlementNotRecordedYet: Story = {
  name: "Not settled yet",
  render: () => <AtCancelledOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("section-settlement")).toBeInTheDocument());

    await waitFor(() => {
      expect(canvas.getByTestId("settlement-absent")).toBeInTheDocument();
    });
  },
};
