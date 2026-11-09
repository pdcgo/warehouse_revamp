import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { liabilityListCalls } from "../../../.storybook/liabilityScenario";
import { liabilityPositions, teams } from "../../../.storybook/fixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { LiabilityListPage } from "./index";

const WAREHOUSE = teams.find((t) => t.id === 11n)!; // the creditor, watching its debtors

const Routed = routedPage(
  [
    { path: "/liability", element: <LiabilityListPage /> },
    marker("/liability/:counterpartyId", "at-pair-detail"),
  ],
  "/liability",
);

const meta = {
  title: "Pages/Liability/PairList",
  component: LiabilityListPage,
  render: () => <Routed />,
  parameters: { signedIn: true, dataRouter: true },
  // The warehouse's Owner: the default terms are theirs to set (the-warehouse-admin-equals-the-owner-except-money).
  beforeEach: () => {
    asTeam(WAREHOUSE.id)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
} satisfies Meta<typeof LiabilityListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("liability-table")).toBeInTheDocument(), {
    timeout: 3000,
  });
  return canvas;
}

// §Frontend Requirements 1 and 2 are ONE SCREEN (the-summary-is-tiles-on-the-list): the tiles
// summarise, the rows below are what they summarise.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("liability-total-payable")).toBeInTheDocument();
    await expect(canvas.getByTestId("liability-table")).toBeInTheDocument();

    // THE TILES ARE THE ORDER LIST'S CARDS (a-list-summary-is-the-order-lists-card-strip): four SummaryCards in one
    // SummaryStrip, each a label, one figure and its line — the oldest debt names its team.
    const strip = canvas.getByTestId("liability-summary");
    await expect(strip.children).toHaveLength(4);
    await expect(within(strip).getByTestId("liability-total-receivable")).toHaveTextContent("Rp 16.150.000");
    await waitFor(() => expect(canvas.getByTestId("liability-oldest-card")).toHaveTextContent("Toko Kenanga"));

    // THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager) — one page here: ‹ [1] ›, always on screen.
    await expect(canvas.getByTestId("liability-pager-page-1")).toBeInTheDocument();
    await expect(canvas.getByTestId("liability-pager-next")).toBeDisabled();
  },
};

// ⛔ THE BUG THIS RETIRES. The tiles used to be a `rows.reduce` over the loaded page, so a creditor
// with more counterparties than fit on a page read a headline that silently omitted the rest — and
// the "total" changed as they paged. It looked right while being wrong.
//
// The whole set is 8.7m + 1m + 6.2m + 250k = 16.15m receivable, and every page must say so.
export const TheSummaryIsTheWholeSetNotThePage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const whole = liabilityPositions.reduce((s, p) => (p.balance > 0 ? s + p.balance : s), 0);

    // The tile reads the SERVER's number. Asserting on the fixture total rather than on a formatted
    // string keeps this a statement about the arithmetic, not about the locale.
    const receivable = canvas.getByText(
      new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      })
        .format(Number(whole))
        .replace(/ /g, " "),
    );

    await expect(receivable).toBeInTheDocument();
  },
};

// §About Thresholds 1 — *"there is warning on the balance screen … if thresholds 80% reached"*.
//
// ⚠ WORDED FROM THE CREDITOR'S SIDE, because this is their screen: they are watching debtors approach
// limits THEY set. Team 12 owes 8.7m against a 10m limit — 87%.
export const ADebtorNearItsLimitIsBadged: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const badge = await canvas.findByTestId("liability-near-limit-12");
    await expect(badge).toHaveTextContent("87%");
  },
};

// THE THREE LIMIT STATES READ DIFFERENTLY. Team 14 is OVER its limit (6.2m against 5m) — blocked, so the badge is red
// and says the next order is refused. Team 13 is FROZEN (limit 0): no credit at all, which refuses its next order
// whatever it owes (the-threshold-defaults-to-unlimited) — a percentage of zero cannot be shown, so it reads "Frozen".
// Team 15 has no row, inheriting the DEFAULT — unlimited — and 80% of unlimited is not a number: no badge.
export const BlockedAndFrozenTeamsAreBadgedUnlimitedIsNot: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("liability-near-limit-14")).toHaveTextContent(
      "124% of the limit you set — their next order is refused",
    );

    await expect(canvas.getByTestId("liability-frozen-13")).toHaveTextContent("Frozen");
    await expect(canvas.queryByTestId("liability-near-limit-13")).not.toBeInTheDocument();

    await expect(canvas.queryByTestId("liability-near-limit-15")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("liability-frozen-15")).not.toBeInTheDocument();
  },
};

// the-warehouse-admin-equals-the-owner-except-money: the warehouse Admin sees the debtors, and no Default Terms.
export const TheWarehouseAdminHasNoDefaultTerms: Story = {
  beforeEach: asRole(Role.WAREHOUSE_ADMIN),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("liability-default-terms")).toBeNull();
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the team type and "awaiting only" are
// its own; a search typed is written back, the others kept.
const AtFilteredUrl = routedPage(
  [{ path: "/liability", element: <><LiabilityListPage /><LocationProbe /></> }],
  `/liability?kind=${TeamType.SELLING}&awaiting=1`,
);

export const FiltersLiveInTheUrl: Story = {
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    // The team type reads the URL's pick in Chakra's Select trigger (chakra-first-whenever-it-has-the-component).
    await expect(canvas.getByTestId("liability-kind")).toHaveTextContent("Selling team");
    await expect(within(canvas.getByTestId("liability-awaiting-only")).getByRole("checkbox")).toBeChecked();

    await userEvent.type(canvas.getByTestId("liability-search"), "Toko", { delay: 40 });
    await waitFor(() => expect(location).toHaveTextContent("q=Toko"));
    await expect(location).toHaveTextContent("awaiting=1");

    // THE URL'S FILTERS ARE SENT, not applied to what loaded (backlog #34): the read carries the type, "awaiting only"
    // and — once typing pauses — the search, and only Toko Melati (12, selling, a payment waiting) comes back.
    await waitFor(() =>
      expect(liabilityListCalls.positions.at(-1)).toMatchObject({
        q: "Toko",
        counterpartyType: TeamType.SELLING,
        awaitingOnly: true,
      }),
    );
    await waitFor(() => expect(canvas.getByTestId("liability-row-12")).toBeInTheDocument());
    await expect(canvas.queryByTestId("liability-row-13")).toBeNull();
    await expect(canvas.queryByTestId("liability-row-15")).toBeNull();
  },
};

// ⛔ THE SEARCH IS THE SERVER'S (backlog #34). It used to narrow the 20 rows the screen had loaded, so a team on page 2
// read as "no team found". The box sends `q` — debounced, one request once typing pauses — over the counterparty's name
// AND its code, and the rows are what came back. The tiles stay the whole set's: a search is not a scope.
export const ASearchFindsATeamByNameOrCodeOnTheServer: Story = {
  render: () => <AtTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const search = canvas.getByTestId("liability-search");
    const receivable = canvas.getByTestId("liability-total-receivable").textContent;

    await userEvent.type(search, "kenanga", { delay: 30 });
    await waitFor(() => expect(liabilityListCalls.positions.at(-1)?.q).toBe("kenanga"));
    await waitFor(() => expect(canvas.queryByTestId("liability-row-12")).toBeNull());
    await expect(canvas.getByTestId("liability-row-13")).toBeInTheDocument();
    // Debounced: the request went once typing paused, not per key.
    await expect(liabilityListCalls.positions.filter((f) => f?.q && f.q !== "kenanga")).toHaveLength(0);
    await expect(canvas.getByTestId("liability-total-receivable")).toHaveTextContent(receivable ?? "");

    // By its CODE — Gudang Cabang is WH-02.
    await userEvent.clear(search);
    await userEvent.type(search, "wh-02", { delay: 30 });
    await waitFor(() => expect(liabilityListCalls.positions.at(-1)?.q).toBe("wh-02"));
    await waitFor(() => expect(canvas.getByTestId("liability-row-14")).toBeInTheDocument());
    await expect(canvas.queryByTestId("liability-row-13")).toBeNull();

    // Nothing matches: the empty hint, not a stale row.
    await userEvent.clear(search);
    await userEvent.type(search, "zzz", { delay: 30 });
    await expect(await canvas.findByTestId("liability-empty")).toBeInTheDocument();
  },
};

// THE TEAM TYPE IS CHAKRA'S SELECT, never a NativeSelect (chakra-first-whenever-it-has-the-component): "All teams" until
// a pick, the pick narrows the rows and is written to the URL, and its × sets it back to all
// (every-filter-clears-from-its-own-x). Warehouses only — Gudang Cabang (14) stays, Toko Melati (12) goes.
const AtTheList = routedPage(
  [{ path: "/liability", element: <><LiabilityListPage /><LocationProbe /></> }],
  "/liability",
);

export const TheTeamTypeFilterNarrowsAndClearsFromItsX: Story = {
  render: () => <AtTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");
    const kind = canvas.getByTestId("liability-kind");

    await expect(kind.tagName).toBe("BUTTON");
    await expect(kind).toHaveTextContent("All teams");
    await expect(await canvas.findByTestId("liability-row-12")).toBeInTheDocument();

    await userEvent.click(kind);
    const warehouses = await canvas.findByTestId(`liability-kind-option-${TeamType.WAREHOUSE}`);
    await waitFor(() => expect(warehouses).toBeVisible());
    await userEvent.click(warehouses);

    await waitFor(() => expect(canvas.queryByTestId("liability-row-12")).toBeNull());
    await expect(canvas.getByTestId("liability-row-14")).toBeInTheDocument();
    await expect(kind).toHaveTextContent("Warehouse team");
    // The pick is SENT (backlog #34) — the server narrows before the page.
    await expect(liabilityListCalls.positions.at(-1)?.counterpartyType).toBe(TeamType.WAREHOUSE);
    await waitFor(() => expect(location).toHaveTextContent(`kind=${TeamType.WAREHOUSE}`));

    const clear = canvas.getByTestId("liability-kind-clear");
    await waitFor(() => expect(clear).toBeVisible());
    await userEvent.click(clear);
    await waitFor(() => expect(canvas.getByTestId("liability-row-12")).toBeInTheDocument());
    await expect(kind).toHaveTextContent("All teams");
    await waitFor(() => expect(location).not.toHaveTextContent("kind="));
  },
};

// THE DEFAULT ROW'S ONLY HOME (the-default-terms-row-is-a-dialog-on-the-list). `counterparty_id = 0`
// is not a pair, so no `/liability/:counterpartyId` page can ever show it — and deleting the terms
// LIST left it settable nowhere in the running app at all.
export const TheDefaultTermsRowIsEditableFromTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("liability-default-terms"));

    // The counterparty is PINNED, not picked — the dialog shows the default row rather than a
    // dropdown that could quietly set one real team's terms instead.
    const fixed = await screen.findByTestId("terms-counterparty-fixed");
    await expect(fixed).toBeInTheDocument();
    await expect(screen.queryByTestId("terms-counterparty")).not.toBeInTheDocument();
  },
};

// THE OPEN PAYMENT REQUEST IS ON THE ROW (a-creditor-may-request-payment) — Gudang Pusat asked Toko Melati (12); Toko
// Kenanga (13) owes too and was not asked, so its row carries nothing.
export const ARequestedPairIsMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("liability-request-12")).toHaveTextContent("Payment requested");
    await expect(canvas.queryByTestId("liability-request-13")).toBeNull();
  },
};

// ── MOBILE (every-page-has-a-mobile-story) — the phone's own arrangement (the-team-balance-phone-layout-is-accepted) ──
//
// ONE BLOCK PER PAIR (a-phone-reads-each-line-as-a-block): the name and what is owed, the kind and the age, the badges —
// and a tap opens the pair. Default Terms is the header's icon (a-phone-header-action-is-an-icon). The tiles stay.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("liability-list-page")).toHaveAttribute("data-layout", "phone");
    await expect(canvas.getByTestId("liability-total-payable")).toBeInTheDocument();

    const list = canvas.getByTestId("liability-table");
    await expect(list).toHaveAttribute("data-layout", "blocks");

    const melati = await canvas.findByTestId("liability-row-12");
    await waitFor(() => expect(melati).toHaveTextContent("Toko Melati"));
    await expect(melati).toHaveTextContent("Rp 8.700.000");
    await expect(melati).toHaveTextContent("Receivable");
    await expect(within(melati).getByTestId("liability-near-limit-12")).toHaveTextContent("87%");
    await expect(within(melati).getByTestId("liability-request-12")).toBeInTheDocument();
    await expect(within(canvas.getByTestId("liability-row-13")).getByTestId("liability-frozen-13")).toBeInTheDocument();

    // No block is wider than the screen — nothing clipped off the edge.
    await expect(melati.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await expect(await canvas.findByTestId("liability-default-terms")).toBeVisible();

    await userEvent.click(melati);
    await expect(await canvas.findByTestId("at-pair-detail")).toBeInTheDocument();
  },
};

// THE FILTERS OPEN FROM A SHEET (a-phone-filters-from-a-sheet): the search stays in the row; the team type, "awaiting
// my confirmation" and "unsettled only" are full-width rows in the sheet, and the Filter button counts what narrows.
export const MobileFiltersFromASheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("liability-search")).toBeVisible();
    await userEvent.click(canvas.getByTestId("liability-filters-open"));
    const sheet = await screen.findByTestId("liability-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());

    // Warehouses only — Gudang Cabang (14) stays, the selling teams go.
    await userEvent.click(within(sheet).getByText("Warehouse team"));
    await waitFor(() => expect(canvas.queryByTestId("liability-row-12")).toBeNull());
    await expect(canvas.getByTestId("liability-row-14")).toBeInTheDocument();
    await expect(within(sheet).getByTestId("liability-unsettled-only")).toBeVisible();
    await expect(within(sheet).getByTestId("liability-awaiting-only")).toBeVisible();
    await expect(canvas.getByTestId("liability-filters-count")).toHaveTextContent("1");

    await userEvent.click(within(sheet).getByTestId("liability-filters-clear"));
    await waitFor(() => expect(canvas.getByTestId("liability-row-12")).toBeInTheDocument());
    await userEvent.click(within(sheet).getByTestId("liability-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("liability-filters-sheet")).toBeNull());
  },
};
