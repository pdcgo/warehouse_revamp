import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orders, shops, teams } from "../../../.storybook/fixtures";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { OrdersPage } from "./index";

// THE ORDER LIST AS THE SELLING TEAM SEES IT — Toko Melati, standing in front of the orders it took.
//
// One page component, two versions, because OrderList is read from BOTH ENDS (#151): `team_id` means
// "the team you hold a role in", and the server matches it against the order's selling team OR its
// warehouse. The warehouse's version of this same screen is in WarehouseOrderList.stories.tsx, and
// the two files exist so the differences between them are pinned rather than described:
//
//   |                    | seller (Toko Melati)              | warehouse (Gudang Pusat)          |
//   | ------------------ | --------------------------------- | --------------------------------- |
//   | which rows         | the orders IT PLACED              | the orders SHIPPING FROM IT       |
//   | the shop filter    | shown — a shop belongs to a team  | hidden — a warehouse holds none   |
//   | the Drafts badge   | its half-typed orders             | 0 — a warehouse never types one   |
//
// The team is chosen by planting the current-team key before the providers mount (`asTeam`), which
// is the same thing the team switcher does — the page itself has no prop for it, and should not.

const TEAM = teams[1]!; // Toko Melati (12)

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
  title: "Pages/Order/SellerOrderListPage",
  component: OrdersPage,
  parameters: {
    // `useTeam()` throws outside a TeamProvider, and this page reads the current team on every path.
    signedIn: true,
    // The page builds its own data router (see pageStory.tsx), so the shared one stands down.
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(TEAM.id),
  render: () => <Routed />,
} satisfies Meta<typeof OrdersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// The fixture orders this team placed, and the one it must never see.
const OWN = orders.filter((o) => o.teamId === TEAM.id);
const SOMEONE_ELSES = orders.find((o) => o.teamId !== TEAM.id)!;
// 109 ships from the OTHER warehouse (Gudang Cabang). It is still Melati's order, so it belongs here
// — which is the half of the two-sided read that a selling-team-only stub would still get right, and
// the reason the warehouse story checks the mirror of it.
const SHIPPED_FROM_ELSEWHERE = OWN.find((o) => o.warehouseId !== teams[0]!.id)!;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE SCOPE IS THE TEAM, whichever warehouse the goods leave from. A selling team's list is every
// order it took and nothing else — another team's orders are not "not shown yet", they are not this
// team's business at all.
export const ShowsEveryOrderThisTeamPlacedAndNobodyElses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`order-row-${OWN[0]!.id}`)).toBeInTheDocument());

    for (const o of OWN) {
      await expect(canvas.getByTestId(`order-row-${o.id}`)).toBeInTheDocument();
    }

    // Toko Kenanga's order, sitting in the same warehouse — invisible from here.
    await expect(canvas.queryByTestId(`order-row-${SOMEONE_ELSES.id}`)).toBeNull();
    // …and an order of ours that ships from a different building is still ours.
    await expect(canvas.getByTestId(`order-row-${SHIPPED_FROM_ELSEWHERE.id}`)).toBeInTheDocument();
  },
};

// The header carries the team, so somebody looking at two tabs on two teams can tell which is which
// without reading the rows.
export const TheHeaderNamesTheTeamAndOffersANewOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByText(TEAM.name)).toBeInTheDocument());

    await userEvent.click(canvas.getByTestId("open-create-order"));
    await waitFor(() => expect(screen.getByTestId("at-order-create")).toBeInTheDocument());
  },
};

// ⚠ THE SHOP FILTER IS THE VISIBLE DIFFERENCE BETWEEN THE TWO VERSIONS. A shop belongs to a SELLING
// team, so it is offered here — and picking one narrows the table server-side, because the list is
// paginated and a client-side filter would narrow the loaded page while the pager kept counting the
// whole set.
export const TheShopFilterIsOfferedAndNarrowsTheTable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const shop = shops[1]!; // Melati Store — orders 102, 105, 108
    const onThatShop = OWN.filter((o) => o.shopId === shop.id);
    const elsewhere = OWN.find((o) => o.shopId !== shop.id)!;

    // ShopSelect renders INLINE (it has to work inside modal Dialogs), so its options are in the
    // canvas rather than a portal.
    await userEvent.click(canvas.getByTestId("shop-select"));
    const option = await canvas.findByTestId(`shop-select-option-${shop.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.queryByTestId(`order-row-${elsewhere.id}`)).toBeNull());
    for (const o of onThatShop) {
      await expect(canvas.getByTestId(`order-row-${o.id}`)).toBeInTheDocument();
    }
  },
};

// Search covers the customer's name and their phone — the two things a CS person has in front of
// them when the buyer rings. Nothing else on screen is narrowed by it except the counts, which is
// the next rule.
export const SearchingByCustomerNarrowsTheTable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const wanted = OWN[0]!;
    const other = OWN[1]!;

    // Typed at a human speed on purpose: the box is debounced, and at machine speed a controlled
    // input drops characters.
    await userEvent.type(canvas.getByTestId("orders-search"), wanted.customerName, { delay: 40 });

    await waitFor(() => expect(canvas.queryByTestId(`order-row-${other.id}`)).toBeNull(), {
      timeout: 3000,
    });
    await expect(canvas.getByTestId(`order-row-${wanted.id}`)).toBeInTheDocument();
  },
};

// ⚠ THE FILTER BAR NARROWS THE WHOLE SCREEN — THE STAT INCLUDED. A header computed without the
// filters would sit above a table describing a smaller set: "To confirm 2" over one visible row,
// with nothing on screen explaining the gap.
export const TheStatFollowsTheFilterBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const placed = OWN.filter((o) => o.status === OrderStatus.PLACED);
    await waitFor(() =>
      expect(canvas.getByTestId("orders-stat-to-confirm")).toHaveTextContent(String(placed.length)),
    );

    await userEvent.type(canvas.getByTestId("orders-search"), placed[0]!.customerName, { delay: 40 });

    // One buyer searched for, so one order left to confirm.
    await waitFor(() => expect(canvas.getByTestId("orders-stat-to-confirm")).toHaveTextContent("1"), {
      timeout: 3000,
    });
  },
};

// …and the TAB does the opposite, deliberately. It narrows the table only: the counts are what you
// read to decide which tab to open next, so recomputing them per tab would empty the very number you
// were about to click.
export const ATabNarrowsTheTableButNeverTheCounts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const before = canvas.getByTestId("orders-tab-count-placed");
    await waitFor(() => expect(before).not.toHaveTextContent("0"));
    const count = before.textContent;

    await userEvent.click(canvas.getByTestId("orders-tab-shipped"));

    const shipped = OWN.find((o) => o.status === OrderStatus.SHIPPED)!;
    const placed = OWN.find((o) => o.status === OrderStatus.PLACED)!;
    await waitFor(() => expect(canvas.getByTestId(`order-row-${shipped.id}`)).toBeInTheDocument());
    await expect(canvas.queryByTestId(`order-row-${placed.id}`)).toBeNull();

    // The Placed tab still says how many are waiting, from the tab you are standing on.
    await expect(canvas.getByTestId("orders-tab-count-placed")).toHaveTextContent(count!);
  },
};

// The date window is what an old order is hidden by. The quick ranges are RELATIVE and live, so this
// asserts against the clock the story runs on rather than a date typed into a fixture.
export const TheDateWindowHidesTheOldOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const old = OWN.find((o) => o.id === 108n)!; // 120 days back — outside every quick range
    const recent = OWN[0]!;

    await waitFor(() => expect(canvas.getByTestId(`order-row-${old.id}`)).toBeInTheDocument());

    await userEvent.click(canvas.getByTestId("orders-date"));
    const last30 = await screen.findByTestId("orders-date-quick-30");
    await waitFor(() => expect(last30).toBeVisible());
    await userEvent.click(last30);

    await waitFor(() => expect(canvas.queryByTestId(`order-row-${old.id}`)).toBeNull());
    await expect(canvas.getByTestId(`order-row-${recent.id}`)).toBeInTheDocument();
  },
};

// Clear appears only when something is actually narrowing the list — and it says so the moment
// somebody types, not after the debounce, because it reads the live control rather than the filter
// the query was built from.
export const ClearAppearsOnlyWhileFilteringAndRestoresEverything: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("orders-clear-filters")).toBeNull();

    await userEvent.type(canvas.getByTestId("orders-search"), "Ani", { delay: 40 });
    await waitFor(() => expect(canvas.getByTestId("orders-clear-filters")).toBeInTheDocument());

    await userEvent.click(canvas.getByTestId("orders-clear-filters"));

    await waitFor(() => expect(canvas.queryByTestId("orders-clear-filters")).toBeNull());
    for (const o of OWN) {
      await expect(canvas.getByTestId(`order-row-${o.id}`)).toBeInTheDocument();
    }
  },
};

// A search that matches nothing says WHICH emptiness this is. "No orders yet" is a statement about
// the team; this one is a statement about what was asked for, and saying the first while a filter is
// narrowing the list would tell somebody their orders are gone when they are one Clear away.
export const AnEmptySearchSaysNothingMatchedRatherThanNoOrders: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("orders-search"), "Pak Zulkarnain", { delay: 40 });

    const empty = await canvas.findByTestId("orders-empty", {}, { timeout: 3000 });
    await expect(empty).toHaveTextContent(/match these filters/i);
  },
};

// THE WHOLE ROW OPENS THE ORDER, as every other list in the app does. The click target used to be
// the `#id` text alone — a few characters wide — so a row that looked clickable everywhere else did
// nothing when you clicked the customer or the total.
export const ClickingAnywhereOnARowOpensTheOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = await canvas.findByTestId(`order-row-${OWN[0]!.id}`);
    await userEvent.click(within(row).getByText(OWN[0]!.customerName));

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// DRAFTS IS THE LAST TAB, and selecting it LEAVES — the drafts screen is its own route with its own
// selection and bulk delete, so the tab is a way in rather than a panel here. Its badge counts the
// whole pile, deliberately unfiltered by the bar above: "is there anything waiting" is a question
// about all of them.
export const TheDraftsTabCountsAndLeaves: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("orders-tab-count-drafts")).toHaveTextContent("2"),
    );

    await userEvent.click(canvas.getByTestId("orders-tab-drafts"));
    await waitFor(() => expect(screen.getByTestId("at-order-drafts")).toBeInTheDocument());
  },
};
