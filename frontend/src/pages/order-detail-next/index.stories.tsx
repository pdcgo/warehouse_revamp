import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orderDetailFor, teams } from "../../../.storybook/fixtures";
import { OrderDetailNextPage } from "./index";
import { ORDER_DETAIL_PENDING } from "./pending";

// THE ORDER DETAIL AS THE OWNER ASKED FOR IT — a PREVIEW, to be looked at before anything is wired.
//
// Seven sections down one page rather than the three tabs the built detail route has: info, items
// with the money derived under them, timeline, shipping, recipient, withdrawal. The header carries
// the status, the deadline and the LIST's per-status actions.
//
// ⚠ IT IS NOT ROUTED. `/orders/:id` still opens `pages/order-detail`; this is Storybook-only, exactly
// as the order list was while it was being argued over.
//
// ⚠ ONE `play()` RULE, now that the owner has approved the design (2026-09-29): every gap the screen
// DECLARES is MARKED on it (`EveryDeclaredGapIsMarkedOnScreen`). It exists because the `deadline` entry
// sat in the pending list for a whole round with no badge anywhere, while the deadline itself was the
// loudest invented thing on the page. The layout rules below stay unpinned for the reason that follows.
//
// ⚠ NO OTHER `play()` RULES HERE, ON PURPOSE. This screen was a PROPOSAL — the section order, the money's
// wording, and whether the withdrawal table belongs here at all are all open. Pinning them now would
// be pinning something nobody has agreed to, and every assertion would be rewritten the moment it is.
// What IS settled is tested where it lives: the margin arithmetic in `Features/Orders/OrderSummary`,
// the per-status actions and the stage vocabulary in `Pages/Order/SellerOrderListPage`.
//
// What to look at:
//
//   • the strip at the top — closed by default; open it for the eight things this screen cannot do
//   • Item order — priced at HARGA BELI, which is what makes the perincian under it add up
//   • the perincian — product total + warehouse fee = system total, against the marketplace's figure
//   • Pengiriman — deliberately almost empty, and saying so rather than hiding
//   • Withdrawal — every row invented, and the section says the design is undecided
//   • the toolbar's *Pending marks → Hidden*, to read the layout without the scaffolding

const SELLER = teams[1]!; // Toko Melati (12)
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

// 101 is the order written out in full — three lines, an address, a note, a receipt, and a
// marketplace total that DISAGREES with ours.
const FULL = orderDetailFor(101n)!;

const Routed = routedPage(
  [
    { path: "/orders/:orderId", element: <OrderDetailNextPage /> },
    marker("/orders", "at-orders"),
  ],
  `/orders/${FULL.id}`,
);

const meta = {
  title: "Pages/Order/OrderDetailNextPage",
  component: OrderDetailNextPage,
  parameters: {
    // `useTeam()` throws outside a TeamProvider, and this page reads the current team on every path.
    signedIn: true,
    // The page builds its own data router (see pageStory.tsx), so the shared one stands down.
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(SELLER.id),
  render: () => <Routed />,
} satisfies Meta<typeof OrderDetailNextPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * THE SAME SCREEN WITH THE SCAFFOLDING OFF — what it will look like when the eight gaps are filled.
 *
 * Worth a story of its own rather than a toolbar flick: this is the version to judge the LAYOUT on,
 * and having both side by side in the sidebar is what makes the marks' cost visible.
 */
export const WithoutTheMarks: Story = {
  globals: { pendingMarks: "off" },
};

// A page routed at a given order — one per story that needs a different subject.
function routedAt(orderId: bigint) {
  return routedPage(
    [
      { path: "/orders/:orderId", element: <OrderDetailNextPage /> },
      marker("/orders", "at-orders"),
    ],
    `/orders/${orderId}`,
  );
}

const PackedForTheWarehouse = routedAt(105n);
const Cancelled = routedAt(107n);
const Returned = routedAt(108n);

/**
 * THE ONE CASE THAT FOLDS INTO `⋯` — a PACKED order read by the warehouse holding it, which is offered
 * four actions: Edit Resi, Jadikan Dikirim, Retur Barang and Selesaikan Order.
 *
 * Two stay as buttons and two fold, and the fold takes the DESTRUCTIVE one first — the button in reach is
 * the one that moves the order on. It is the only stage that reaches the limit today, which is the point
 * of the rule: the overflow exists for the exception, not the rule.
 */
export const FourActionsFoldIntoMore: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <PackedForTheWarehouse />,
};

/** An end state offers nothing — and nothing is drawn: no empty bar, no disabled buttons. */
export const ACancelledOrderHasNoActions: Story = {
  render: () => <Cancelled />,
};

/**
 * BOTH LEGS OF THE PARCEL, POPULATED — out to the buyer and back, each with its own courier, tracking
 * number and trail (owner: *"resi bisa 2 dan jejak pengiriman juga bisa 2, dari order dan return"*).
 *
 * 108 is the only fixture given a return, and it is invented: there is no return record at all yet.
 * It also has a marketplace reference but NO marketplace total, so its margin refuses — the two
 * absences the list keeps apart, seen here from the detail.
 */
export const WithAReturn: Story = {
  render: () => <Returned />,
};

/**
 * ⚠ EVERY GAP THE SCREEN DECLARES HAS A MARK ON IT. A pending entry with no badge is a screen that
 * lists an invented figure in its summary strip and then shows that figure unmarked where people read it
 * — which is what happened to the deadline.
 *
 * No exemptions (owner: *"kasih saja dulu seperti lainnya"*) — `lifecycle` too is marked beside the
 * header's actions on every order, not only on one that happens to offer an unbuilt action.
 */
export const EveryDeclaredGapIsMarkedOnScreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("summary-tiles")).toBeInTheDocument());

    for (const part of ORDER_DETAIL_PENDING.parts) {
      await expect(canvas.queryAllByTestId(`not-implemented-${part.id}`).length).toBeGreaterThan(0);
    }
  },
};
