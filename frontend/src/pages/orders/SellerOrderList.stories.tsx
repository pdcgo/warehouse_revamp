import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orders, shops, teams, users } from "../../../.storybook/fixtures";
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

/**
 * WHERE THE FILTER CONTROLS ARE. On a phone every control but the search lives in a bottom sheet behind
 * the Filter button (`FilterBar`, rule 4) — and the story runner's canvas IS phone-width — so open it
 * when it is there and hand back its scope. On a desktop canvas the controls are inline.
 */
async function filterControls(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const open = canvas.queryByTestId("orders-filters-open");

  if (!open) {
    return canvas;
  }

  await userEvent.click(open);
  const sheet = await screen.findByTestId("orders-filters-sheet");
  await waitFor(() => expect(sheet).toBeVisible());

  return within(sheet);
}

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

// THE SAME LIST, ON A PHONE-SHAPED CANVAS (owner). What to look at: the stat tiles stacking, the
// filter strip wrapping rather than squeezing its pickers (FilterBar's rule), and the TABLE — a
// row of columns written for a desktop, on a screen that cannot hold them.
//
// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only, and the story runner has one
// fixed viewport (MobileLayout.stories), so an assertion here would describe a width nothing renders
// at. This is for looking. The shell around it is Layouts/Mobile/AppShell.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

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

    // ShopSelect renders INLINE (it has to work inside modal Dialogs), so its options are beside it —
    // in the canvas on a desktop, in the filter sheet on a phone.
    const controls = await filterControls(canvasElement);
    await userEvent.click(controls.getByTestId("shop-select"));
    const option = await controls.findByTestId(`shop-select-option-${shop.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.queryByTestId(`order-row-${elsewhere.id}`)).toBeNull());
    for (const o of onThatShop) {
      await expect(canvas.getByTestId(`order-row-${o.id}`)).toBeInTheDocument();
    }
  },
};

// a-who-filter-lists-the-people-on-its-rows: the creator filter offers who typed THIS team's orders in — Eko, Budi,
// and Citra, suspended and kept with a badge (a-filter-keeps-former-and-suspended-people) — and never Ani, who typed
// only another team's. Picking one narrows the table to theirs, and each row names who typed it in.
export const TheCreatorFilterOffersWhoTypedTheOrdersIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const eko = users[4]!;
    const citra = users[2]!;
    const ani = users[0]!;
    const ekos = OWN.filter((o) => o.createdByUserId === eko.id);
    const notEkos = OWN.find((o) => o.createdByUserId !== eko.id)!;

    const row = await canvas.findByTestId(`order-row-${ekos[0]!.id}`);
    await waitFor(() => expect(within(row).getByTestId("order-placed-by")).toHaveTextContent(eko.name));

    const controls = await filterControls(canvasElement);
    await userEvent.click(within(controls.getByTestId("orders-creator-filter")).getByRole("combobox"));

    const option = await screen.findByTestId(`person-filter-option-${eko.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await expect(screen.getByTestId(`person-filter-suspended-${citra.id}`)).toBeInTheDocument();
    await expect(screen.queryByTestId(`person-filter-option-${ani.id}`)).toBeNull();

    await userEvent.click(option);

    await waitFor(() => expect(canvas.queryByTestId(`order-row-${notEkos.id}`)).toBeNull());
    for (const o of ekos) {
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
export const TheSummaryFollowsTheFilterBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // `pending` is the owner's name for what the contract still calls PLACED.
    const placed = OWN.filter((o) => o.status === OrderStatus.PLACED);
    await waitFor(() =>
      expect(canvas.getByTestId("order-summary-row-pending")).toHaveTextContent(
        `${placed.length} tx`,
      ),
    );

    await userEvent.type(canvas.getByTestId("orders-search"), placed[0]!.customerName, { delay: 40 });

    // One buyer searched for, so one order left to confirm.
    await waitFor(
      () => expect(canvas.getByTestId("order-summary-row-pending")).toHaveTextContent("1 tx"),
      { timeout: 3000 },
    );
  },
};

// …and the TAB does the opposite, deliberately. It narrows the table only: the counts are what you
// read to decide which tab to open next, so recomputing them per tab would empty the very number you
// were about to click.
export const ATabNarrowsTheTableButNeverTheCounts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const before = canvas.getByTestId("orders-tab-count-pending");
    await waitFor(() => expect(before).not.toHaveTextContent("0"));
    const count = before.textContent;

    await userEvent.click(canvas.getByTestId("orders-tab-shipped"));

    const shipped = OWN.find((o) => o.status === OrderStatus.SHIPPED)!;
    const placed = OWN.find((o) => o.status === OrderStatus.PLACED)!;
    await waitFor(() => expect(canvas.getByTestId(`order-row-${shipped.id}`)).toBeInTheDocument());
    await expect(canvas.queryByTestId(`order-row-${placed.id}`)).toBeNull();

    // The Placed tab still says how many are waiting, from the tab you are standing on.
    await expect(canvas.getByTestId("orders-tab-count-pending")).toHaveTextContent(count!);
  },
};

// ⚠ …AND "DIPROSES" CANNOT NARROW AT ALL, WHICH IS WHY THE STEP FILTER EXISTS. The owner folded four
// warehouse steps into one status and `OrderListFilter.status` takes exactly one enum value — so the
// tab can COUNT its three (confirmed, picking, packed) and cannot narrow to them. Picking a step does
// what the tab cannot.
//
// ⚠ THIS TEST IS PINNED TO A GAP, ON PURPOSE. It is the `statusSet` mark written as an assertion, so
// the day the enum gains a single `PROCESSED` value this fails and somebody re-reads the step filter's
// reason for existing.
export const DiprosesCountsButOnlyAStepCanNarrow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const packed = OWN.find((o) => o.status === OrderStatus.PACKED)!;
    const placed = OWN.find((o) => o.status === OrderStatus.PLACED)!;

    await userEvent.click(canvas.getByTestId("orders-tab-processed"));

    // The tab alone leaves the table as it was — the pending order is still listed.
    await waitFor(() => expect(canvas.getByTestId(`order-row-${packed.id}`)).toBeInTheDocument());
    await expect(canvas.getByTestId(`order-row-${placed.id}`)).toBeInTheDocument();

    // One step IS one enum value, so it narrows.
    await userEvent.click(canvas.getByTestId("processed-step-filter-packed"));

    await waitFor(() => expect(canvas.queryByTestId(`order-row-${placed.id}`)).toBeNull());
    await expect(canvas.getByTestId(`order-row-${packed.id}`)).toBeInTheDocument();
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

    const controls = await filterControls(canvasElement);
    await userEvent.click(controls.getByTestId("orders-date"));
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

    await expect(canvas.queryByTestId("orders-filters-clear")).toBeNull();

    await userEvent.type(canvas.getByTestId("orders-search"), "Ani", { delay: 40 });

    // On a phone Clear is in the sheet's footer, beside Done.
    const controls = await filterControls(canvasElement);
    await waitFor(() => expect(controls.getByTestId("orders-filters-clear")).toBeInTheDocument());

    await userEvent.click(controls.getByTestId("orders-filters-clear"));

    await waitFor(() => expect(controls.queryByTestId("orders-filters-clear")).toBeNull());
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
// nothing when you clicked the shop or the total.
//
// ⚠ IT CLICKS THE DATE, WHICH IS THE POINT: a cell with nothing interactive in it, far from the two
// copy buttons and the kebab. Those three stop the click on purpose (copying a number must not also
// navigate), and a story that clicked one of them would pass while the rest of the row was dead.
export const ClickingAnywhereOnARowOpensTheOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = await canvas.findByTestId(`order-row-${OWN[0]!.id}`);
    await userEvent.click(within(row).getByTestId("order-placed-at"));

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// …and the two COPY buttons do NOT open it. Carrying a tracking number to a courier's site is the
// commonest thing anybody does on this screen, and doing it must not also leave the page — the copy
// would succeed and nobody would see it happen.
export const CopyingAReferenceDoesNotOpenTheOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = await canvas.findByTestId(`order-row-${OWN[0]!.id}`);
    await userEvent.click(within(row).getByTestId("order-receipt"));

    await expect(screen.queryByTestId("at-order-detail")).toBeNull();
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

/**
 * ⚠ ON A PHONE THE FILTERS ARE A SHEET (owner: *"bentuk filter di order list cukup berantakan pada
 * tampilan mobile"*). The search stays in the row; the pickers are behind the Filter button, which counts
 * what is narrowing the list. Six ragged rows of controls were ~280px of the screen before the tabs.
 */
export const OnAPhoneTheFiltersAreASheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("orders-search")).toBeVisible();
    await expect(canvas.queryByTestId("shop-select")).toBeNull();
    await expect(canvas.queryByTestId("orders-filters-count")).toBeNull();

    await userEvent.type(canvas.getByTestId("orders-search"), "Ani", { delay: 40 });
    await waitFor(() => expect(canvas.getByTestId("orders-filters-count")).toHaveTextContent("1"));

    const controls = await filterControls(canvasElement);
    await expect(controls.getByTestId("shop-select")).toBeVisible();
    await expect(controls.getByTestId("orders-date")).toBeVisible();

    await userEvent.click(controls.getByTestId("orders-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("orders-filters-sheet")).toBeNull());
  },
};
