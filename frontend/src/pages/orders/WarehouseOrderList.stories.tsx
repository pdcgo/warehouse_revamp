import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orders, teams } from "../../../.storybook/fixtures";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { OrdersPage } from "./index";

// THE SAME SCREEN, STOOD IN A WAREHOUSE — Gudang Pusat, looking at the orders it has to ship.
//
// It is one page component and one RPC (#151): `team_id` is "the team you hold a role in", and the
// server matches it against the order's SELLING TEAM or its WAREHOUSE. So this is not a second
// screen, it is the same question asked from the other end — and these stories pin the three things
// that come out different. The seller's half is SellerOrderList.stories.tsx.
//
// ⚠ WHY THIS DESERVES ITS OWN STORY FILE. Everything below passes trivially on a list that filters
// by the selling team alone, EXCEPT the row set — which would be empty, and an empty table on this
// screen reads as "nothing to pick today" rather than as a broken read. That failure is silent
// exactly where it costs the most, so it is the one pinned first.

const TEAM = teams[0]!; // Gudang Pusat (11)
const OTHER_WAREHOUSE = teams[3]!; // Gudang Cabang (14)

const Routed = routedPage(
  [
    { path: "/orders", element: <OrdersPage /> },
    marker("/orders/new", "at-order-create"),
    marker("/orders/:orderId", "at-order-detail"),
    marker("/order-drafts", "at-order-drafts"),
  ],
  "/orders",
);

const meta = {
  title: "Pages/Order/WarehouseOrderListPage",
  component: OrdersPage,
  parameters: {
    signedIn: true,
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(TEAM.id),
  render: () => <Routed />,
} satisfies Meta<typeof OrdersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// What ships from this building, whoever sold it.
const SHIPPING_FROM_HERE = orders.filter((o) => o.warehouseId === TEAM.id);
// Another team's order sitting on this floor — the crew has to pick it, so it is here.
const ANOTHER_TEAMS = SHIPPING_FROM_HERE.find((o) => o.teamId !== teams[1]!.id)!;
// …and one that belongs to a team this warehouse serves but ships from the OTHER building.
const SHIPS_ELSEWHERE = orders.find((o) => o.warehouseId === OTHER_WAREHOUSE.id)!;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// ⚠ THE SCOPE IS THE BUILDING, NOT THE SELLER. Every order shipping from here is here — including
// the ones belonging to a selling team whose own list this crew can never see — and an order placed
// by a team it serves is NOT here if the goods leave from somewhere else. Both halves matter: the
// first is the queue, the second is the guarantee that a crew is never shown work that is not its
// own to do.
export const ShowsEveryOrderShippingFromThisWarehouseWhoeverSoldIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId(`order-row-${SHIPPING_FROM_HERE[0]!.id}`)).toBeInTheDocument(),
    );

    for (const o of SHIPPING_FROM_HERE) {
      await expect(canvas.getByTestId(`order-row-${o.id}`)).toBeInTheDocument();
    }

    // Toko Kenanga's — a selling team, not this warehouse, and its order is on this floor.
    await expect(canvas.getByTestId(`order-row-${ANOTHER_TEAMS.id}`)).toBeInTheDocument();
    // Shipping from Gudang Cabang: somebody else's job.
    await expect(canvas.queryByTestId(`order-row-${SHIPS_ELSEWHERE.id}`)).toBeNull();
  },
};

// ⚠ THE SHOP FILTER IS HIDDEN HERE, and it is HIDDEN rather than DISABLED. A shop belongs to a
// selling team; a warehouse holds none, so the control would be an empty dropdown that never filters
// anything — and an empty dropdown reads as "no shops loaded", which is a bug report waiting to
// happen. The other two filters are the warehouse's just as much as the seller's, so they stay.
export const TheShopFilterIsNotOfferedToAWarehouse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("orders-table")).toBeInTheDocument());

    await expect(canvas.queryByTestId("shop-select")).toBeNull();
    await expect(canvas.getByTestId("orders-search")).toBeInTheDocument();
    await expect(canvas.getByTestId("orders-date")).toBeInTheDocument();
  },
};

// The counts are computed over the SAME two-sided set the table shows, so the crew's queue adds up:
// what is waiting to be accepted, and what the building is already holding.
export const TheStatCountsBothSellingTeamsWork: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const placed = SHIPPING_FROM_HERE.filter((o) => o.status === OrderStatus.PLACED);
    const held = SHIPPING_FROM_HERE.filter((o) =>
      [OrderStatus.CONFIRMED, OrderStatus.PICKING, OrderStatus.PACKED].includes(o.status),
    );

    // 3, not 2: one of them is Kenanga's. A selling-team-only read would say 2 here and the crew
    // would be one order short with nothing telling them so.
    await waitFor(() =>
      expect(canvas.getByTestId("orders-stat-to-confirm")).toHaveTextContent(String(placed.length)),
    );
    await expect(canvas.getByTestId("orders-stat-in-warehouse")).toHaveTextContent(
      String(held.length),
    );
  },
};

// The status tabs ARE the crew's steps — placed → confirmed → picking → packed → shipped — so this
// strip is the pick queue read one stage at a time.
export const TheStatusTabNarrowsToOneStageOfTheCrewsWork: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const packed = SHIPPING_FROM_HERE.find((o) => o.status === OrderStatus.PACKED)!;
    const placed = SHIPPING_FROM_HERE.find((o) => o.status === OrderStatus.PLACED)!;

    await userEvent.click(canvas.getByTestId("orders-tab-packed"));

    await waitFor(() => expect(canvas.getByTestId(`order-row-${packed.id}`)).toBeInTheDocument());
    await expect(canvas.queryByTestId(`order-row-${placed.id}`)).toBeNull();
  },
};

// A status the queue currently has nothing in says so as a statement about THAT STATUS, not about
// the warehouse — "no orders yet" over an empty Cancelled tab would read as if the building had
// never shipped anything.
export const AnEmptyStatusNamesTheStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Nothing shipping from here is cancelled — 107 is Melati's, and it is.
    await userEvent.click(canvas.getByTestId("orders-tab-cancelled"));

    const empty = await canvas.findByTestId("orders-empty");
    await expect(empty).toHaveTextContent(/cancelled/i);
  },
};

// Searching a buyer's name finds the order whoever sold it — the crew is handed a phone number and a
// name, not a shop.
export const SearchReachesTheOtherTeamsOrderToo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("orders-search"), ANOTHER_TEAMS.customerName, {
      delay: 40,
    });

    // Wait on what LEAVES, not on what stays. The search is debounced and the table keeps its
    // previous rows while the next answer loads (that is the point of `listQuery`), so the row this
    // story is about is already on screen before the filter has done anything — asserting its
    // presence would pass instantly and prove nothing.
    await waitFor(
      () => expect(canvas.queryByTestId(`order-row-${SHIPPING_FROM_HERE[0]!.id}`)).toBeNull(),
      { timeout: 3000 },
    );
    await expect(canvas.getByTestId(`order-row-${ANOTHER_TEAMS.id}`)).toBeInTheDocument();
  },
};

// The DRAFTS tab is still here, and its badge reads 0 — a draft belongs to the team that typed it,
// and a warehouse types none. The tab is not hidden for a warehouse, so the number is what says the
// pile is empty rather than the tab's absence.
export const TheDraftsBadgeIsZeroForAWarehouse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("orders-tab-count-drafts")).toHaveTextContent("0"),
    );
  },
};

// A row opens the order from this side too, and it has to: THE PICK LIST IS THE ORDER'S LINES, and
// nothing else returns them. A crew that can list its queue but not open an order can see there is
// work and not what the work is.
export const ARowOpensTheOrderTheCrewHasToPick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = await canvas.findByTestId(`order-row-${ANOTHER_TEAMS.id}`);
    await userEvent.click(within(row).getByText(ANOTHER_TEAMS.customerName));

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};
