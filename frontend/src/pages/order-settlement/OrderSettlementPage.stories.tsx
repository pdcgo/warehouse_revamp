import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { ALL_DATES } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import {
  DEFAULT_SETTLEMENT_SORT,
  type SettlementSort,
  type SettlementSortKey,
} from "../../features/settlement/queries";
import { windowOf } from "../../features/settlement/window";
import { OrderSettlementPage, settlementTotalsOf, type OrderSettlementPageProps } from "./index";
import { SETTLEMENT_PAGE_SIZE_OPTIONS } from "./SettlementListRoute";
import { allOrders, noEstimate, worked } from "./fixtures";
import { hiddenCost, loss, type OrderSettlement } from "./model";

// THE SETTLEMENT LIST — orders ranked by how much of what the buyer paid never reached us.
//
// Rows come in as a prop — `SettlementListRoute` passes them from the query — so every story here
// pins the design without a server. Each one renders as the route mounts it: the filter bar
// (`the-settlement-list-filters-what-the-contract-can`) and the pager, which the page always has
// (`the-settlement-list-always-shows-its-pager`).
//
// The screen exists to answer one question — *which orders went furthest wrong* — and to NOT answer
// two it would be natural to expect of it:
//
//   - it is not a worklist. `a-residual-balance-is-normal` means almost every order ends non-zero, so
//     a queue of "unsettled" orders would contain all of them.
//   - it is not a debt list. `hidden-cost-is-left-in-the-balance` means the gap is already gone and
//     nobody is collecting it. The column is **Lost**, never "outstanding".
// The selling team the fixtures' shops belong to in the stub (Melati Official 21, Melati Store 22).
const TEAM_ID = 12n;

// When an account last MOVED — its latest entry's posted day, which is what the server's
// `updated_at` window reads.
function lastMoved(order: OrderSettlementPageProps["orders"][number]): string {
  return order.entries.reduce((latest, e) => (e.postedOn > latest ? e.postedOn : latest), "");
}

const MEASURE: Record<SettlementSortKey, (o: OrderSettlement) => bigint> = {
  orderId: (o) => o.orderId,
  sold: (o) => o.initialTotal,
  received: (o) => o.lastBalance + o.initialTotal,
  loss: (o) => -o.lastBalance,
};

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

// The server's ORDER BY: an unrecorded sale last under a money measure whichever way, the measure in
// the chosen direction, the order id breaking ties in the same direction.
function sortLikeTheServer(rows: OrderSettlement[], sort: SettlementSort): OrderSettlement[] {
  const dir = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (sort.by !== "orderId") {
      const unA = a.initialTotal === 0n;
      const unB = b.initialTotal === 0n;
      if (unA !== unB) return unA ? 1 : -1;
    }
    return cmp(MEASURE[sort.by](a), MEASURE[sort.by](b)) * dir || cmp(a.orderId, b.orderId) * dir;
  });
}

/**
 * The list as the route mounts it — filters, sort and pager with their own state — and a stand-in for
 * the SERVER: it narrows the rows the way `OrderSettlementList` does (id substring, one shop, the
 * last-moved window), sorts them by its ORDER BY, and sums them by its rules, so a story can watch a
 * filter or a heading actually take effect.
 */
function ListAsRouted(props: OrderSettlementPageProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [shopId, setShopId] = useState(0n);
  const [range, setRange] = useState<DateRange>(ALL_DATES);
  const [sort, setSort] = useState<SettlementSort>(DEFAULT_SETTLEMENT_SORT);

  const { from, to } = windowOf(range);
  const q = search.trim();
  const rows = sortLikeTheServer(
    props.orders.filter(
      (o) =>
        (q === "" || String(o.orderId).includes(q)) &&
        (shopId === 0n || o.shopId === shopId) &&
        (from === "" || lastMoved(o) >= from) &&
        (to === "" || lastMoved(o) <= to),
    ),
    sort,
  );

  return (
    <OrderSettlementPage
      {...props}
      orders={rows}
      sort={{ ...sort, onChange: setSort }}
      totals={settlementTotalsOf(rows)}
      filters={{
        teamId: TEAM_ID,
        search,
        onSearchChange: setSearch,
        shopId,
        onShopChange: setShopId,
        range,
        onRangeChange: setRange,
      }}
      paging={{
        page,
        pageSize,
        count: rows.length,
        onPageChange: setPage,
        pageSizeOptions: SETTLEMENT_PAGE_SIZE_OPTIONS,
        onPageSizeChange: (size) => {
          setPageSize(size);
          setPage(1);
        },
      }}
    />
  );
}

/**
 * WHERE THE FILTER CONTROLS ARE. On a phone every control but the search sits in a bottom sheet behind
 * the Filter button. The runner's viewport is a desktop one, where they sit in the row — but the
 * workbench can be phone-width, so open the sheet whenever it is there.
 */
async function filterControls(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const open = canvas.queryByTestId("settlement-filters-open");
  if (!open) return canvas;

  await userEvent.click(open);
  const sheet = await screen.findByTestId("settlement-filters-sheet");
  await waitFor(() => expect(sheet).toBeVisible());
  return within(sheet);
}

async function closeFilters() {
  const done = screen.queryByTestId("settlement-filters-done");
  if (done) {
    await userEvent.click(done);
    await waitFor(() => expect(screen.queryByTestId("settlement-filters-sheet")).toBeNull());
  }
}

const meta = {
  title: "Pages/Order Settlement/List",
  component: OrderSettlementPage,
  render: (args) => <ListAsRouted {...args} />,
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

    // ⚠ The ranking comes from the SORT the list opens on — Lost, largest first — shown on its heading.
    await expect(canvas.getByTestId("settlement-sort-loss")).toHaveAttribute("data-sort", "desc");

    // The vocabulary check, on the whole page: nothing here may imply somebody owes us.
    await expect(canvasElement).not.toHaveTextContent(/outstanding|unpaid|overdue/i);

    // ⚠ The pager is there on ONE page (owner: always shown) — six orders fit, and it still reads 1 of 1,
    // with the per-page selector beside it.
    await expect(canvas.getByTestId("pagination-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("page-next")).toBeDisabled();
    await expect(canvas.getByTestId("page-size")).toHaveTextContent("20");
  },
};

/**
 * THE SUMMARY IS THE ORDER LIST'S CARDS (owner: *"aku ingin statistik designnya seperti di order
 * list"*) — over the WHOLE filtered set, by the server's rules: an unrecorded sale is counted, and left
 * out of every sum. There is no deductions card: it cannot be summed without the payouts.
 */
export const TheSummaryIsTheOrderListsCards: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const strip = canvas.getByTestId("settlement-summary");

    await expect(within(strip).getAllByTestId(/^settlement-stat-[a-z]+$/)).toHaveLength(4);
    await expect(canvas.getByTestId("settlement-stat-orders")).toHaveTextContent("1 with no marketplace selling price");
    await expect(canvas.getByTestId("settlement-stat-sold-value")).toHaveTextContent("851.000");
    // An adjustment of −143.500 over 851.000 of sales — signed, so the minus is read first — and the
    // unrecorded order's +62.000 payout does NOT offset it.
    await expect(canvas.getByTestId("settlement-stat-lost-value")).toHaveTextContent("−Rp 143.500");
    await expect(canvas.getByTestId("settlement-stat-lost")).toHaveTextContent("16.86% of sales");
    await expect(canvas.getByTestId("settlement-stat-received-value")).toHaveTextContent("707.500");

    // The figure the server cannot sum is not on the strip at all — never summed from this page.
    await expect(canvas.queryByTestId("settlement-stat-hidden")).toBeNull();
    await expect(hiddenCost(noEstimate)).toBe(-62_000n);
  },
};

/**
 * A HEADING SORTS (owner): the first click is the largest first, the next flips it — and back, never a
 * third state. The unrecorded sale stays at the bottom both ways: its figures are not real.
 */
export const AHeadingSortsAndFlips: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sold = canvas.getByTestId("settlement-sort-sold");
    const rows = () => canvas.getAllByTestId(/^settlement-row-/);

    await userEvent.click(sold);
    await waitFor(() => expect(sold).toHaveAttribute("data-sort", "desc"));
    await expect(rows()[0]).toHaveAttribute("data-testid", "settlement-row-4"); // 310.000
    await expect(rows()[5]).toHaveAttribute("data-testid", "settlement-row-6");

    await userEvent.click(sold);
    await waitFor(() => expect(sold).toHaveAttribute("data-sort", "asc"));
    await expect(rows()[0]).toHaveAttribute("data-testid", "settlement-row-2"); // 85.000
    await expect(rows()[5]).toHaveAttribute("data-testid", "settlement-row-6");

    await userEvent.click(sold);
    await waitFor(() => expect(sold).toHaveAttribute("data-sort", "desc"));
    // Shop does not sort — no button on it.
    await expect(canvas.queryByTestId("settlement-sort-shop")).toBeNull();
  },
};

/**
 * ON A PHONE THE SORT IS IN THE SHEET — a list read as blocks has no heading to tap, so the Filter
 * sheet carries one more control, *Sort*, listing every heading's two directions.
 *
 * ⚠ NO `play()`, DELIBERATELY: the `viewport` global resizes the WORKBENCH canvas only — the story
 * runner has one fixed desktop viewport (see MobileLayout.stories), where the sheet does not exist.
 * Open the Filter button here to review it.
 */
export const Mobile: Story = {
  args: { orders: allOrders },
  globals: { viewport: { value: "mobile2" } },
};

/**
 * THE SHOP IS THE DESIGN SYSTEM'S `ShopSelect` (owner), over the team's real shops — not a list built
 * from the rows on this page, which could only ever offer the shops that happen to be on it. Choosing
 * one narrows the table and the card together: they are the same population.
 */
export const FilteredByShop: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const controls = await filterControls(canvasElement);

    await userEvent.click(controls.getByTestId("shop-select"));
    const store = await controls.findByTestId("shop-select-option-22");
    await waitFor(() => expect(store).toBeVisible());
    await userEvent.click(store);
    await closeFilters();

    await waitFor(async () => {
      await expect(canvas.getAllByTestId(/^settlement-row-/)).toHaveLength(3);
    });
    // The summary follows the filter, or it would describe a different set than the table.
    await expect(canvas.getByTestId("settlement-stat-orders-value")).toHaveTextContent("3");
  },
};

/**
 * THE SEARCH IS THE ORDER ID (owner), and says so: settlement keys on our id and never sees the
 * marketplace's reference, so that is the only thing the server can match.
 */
export const SearchByOrderId: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByTestId("settlement-search");

    await expect(search).toHaveAttribute("placeholder", expect.stringMatching(/order id/i));
    await userEvent.type(search, "4", { delay: 40 });

    await waitFor(async () => {
      await expect(canvas.getAllByTestId(/^settlement-row-/)).toHaveLength(1);
    });
    await expect(canvas.getByTestId("settlement-row-4")).toBeInTheDocument();
  },
};

/**
 * THE DATE IS THE ORDER LIST'S PICKER (owner), naming what it filters: when the account last MOVED,
 * not when the order was placed. Every fixture last moved in January 2026, so the last 7 days hold
 * none of them — and Clear brings every row back.
 */
export const TheDateIsWhenTheAccountLastMoved: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    let controls = await filterControls(canvasElement);

    await expect(controls.getByTestId("settlement-date-field")).toHaveTextContent(/last moved/i);
    await userEvent.click(controls.getByTestId("settlement-date"));
    const week = await screen.findByTestId("settlement-date-quick-7");
    await waitFor(() => expect(week).toBeVisible());
    await userEvent.click(week);
    await closeFilters();

    await waitFor(async () => {
      await expect(canvas.queryAllByTestId(/^settlement-row-/)).toHaveLength(0);
    });

    controls = await filterControls(canvasElement);
    await userEvent.click(controls.getByTestId("settlement-filters-clear"));
    await closeFilters();
    await waitFor(async () => {
      await expect(canvas.getAllByTestId(/^settlement-row-/)).toHaveLength(6);
    });
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
    await expect(canvas.getByTestId("row-no-estimate")).toHaveTextContent(/no marketplace selling price recorded/i);
  },
};

/**
 * NO SOURCE BADGE AND NO DEDUCTIONS ON THE ROW (owner: *"hilangkan sama sekali"*, *"hilangkan potongan
 * karena memang tidak ada"*) — not even on the corrected-by-hand order. Both read an order's entries,
 * which a list row does not carry, so they could only be right here, never live. Both show in the
 * order's ledger.
 */
export const TheRowCarriesNoEntryFacts: Story = {
  args: { orders: allOrders },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId("settlement-row-4");
    await expect(canvas.queryAllByTestId(/^source-badge-/)).toHaveLength(0);
    // Five columns — order, shop, sold for, received, adjustment — and no deductions.
    await expect(row.querySelectorAll("td")).toHaveLength(5);
    await expect(canvasElement).not.toHaveTextContent(/deductions|never itemised/i);
  },
};

/** Clicking a row opens the order — the list is a way in, not a destination. */
export const OpensAnOrder: Story = {
  args: { orders: allOrders },
  render: function Render(args) {
    const [opened, setOpened] = useState<bigint | null>(null);
    return (
      <>
        <ListAsRouted {...args} onOpenOrder={setOpened} />
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
    // The summary still renders, at zero, rather than vanishing — a missing card reads as a broken page.
    await expect(canvas.getByTestId("settlement-summary")).toBeInTheDocument();
    // …and so does the pager with its per-page selector, for the same reason (owner: always shown).
    await expect(canvas.getByTestId("pagination-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("page-size")).toBeInTheDocument();
    await expect(loss(worked)).toBe(10_000n);
  },
};
