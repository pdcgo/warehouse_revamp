import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { asRole } from "../../../.storybook/sessionScenario";
import { supplierFixture } from "../../../.storybook/supplierFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { SuppliersPage } from "./index";

// ⚠ PROTOTYPE for design_accept — the supplier CRUD pass
// (docs/business/supplier/context_clarify.md#proposed-design).
//
// The MANAGE page (manage-and-discover-are-two-pages): a selling team's own suppliers. The stub plays
// supplier_service (supplierStub.ts) — the OWN scope, soft deletes, and a create only a selling team may make.

const SUMBER = supplierFixture("PT Sumber Makmur");
const CAHAYA = supplierFixture("CV Cahaya Abadi");
const SINAR = supplierFixture("Toko Grosir Sinar");
const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's — never on team 12's list
const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // team 12's, deleted

const SELLING_TEAM = 12n;
const WAREHOUSE_TEAM = 11n;

function standingIn(teamId: bigint) {
  return () => {
    asTeam(teamId)();
    asRole(Role.SELLING_OWNER)();
  };
}

const meta = {
  title: "Pages/Suppliers/Suppliers",
  component: SuppliersPage,
  parameters: { signedIn: true },
  beforeEach: standingIn(SELLING_TEAM),
} satisfies Meta<typeof SuppliersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`supplier-row-${SUMBER.id}`, {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// A PHONE READS EACH SUPPLIER AS A BLOCK (a-phone-reads-each-line-as-a-block) — the name and its stores, or words saying
// it has none; no contact, no address; no headings, so the sort is the Filter sheet's, with the store type.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("suppliers-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const sumber = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    await expect(sumber).toHaveTextContent("Shopee");
    // Its name and its stores — no contact, no address (a-phone-supplier-is-its-name-and-stores).
    await expect(sumber).not.toHaveTextContent(SUMBER.contact);
    await expect(sumber).not.toHaveTextContent(SUMBER.address);
    // A supplier with no store says so in words, not a dash.
    await expect(canvas.getByTestId(`supplier-row-${SINAR.id}-no-stores`)).toHaveTextContent("No supplier stores yet");

    await userEvent.click(canvas.getByTestId("suppliers-filter-open"));
    const sheet = await screen.findByTestId("suppliers-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("supplier-sort-select")).toBeVisible();
    await expect(within(sheet).getByTestId("marketplace-select")).toBeVisible();
  },
};

export const AWarehouseTeam: Story = { beforeEach: standingIn(WAREHOUSE_TEAM) };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-supplier-has-no-code · no-province-or-city: Name, Contact, Address — no Code, no City.
export const TheDecidedColumns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = canvas.getByTestId("suppliers-table");

    await expect(within(table).queryByText("Code")).toBeNull();
    await expect(within(table).queryByText("City")).toBeNull();
    await expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toHaveTextContent(SUMBER.address);
  },
};

// The page lists THIS team's live suppliers only: another selling team's is Discover's question, and a deleted one
// has left every list (a-deleted-supplier-is-kept-for-its-figures).
export const OnlyThisTeamsLiveSuppliers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId(`supplier-row-${MAKMUR_JAYA.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`supplier-row-${LAMA_TUTUP.id}`)).toBeNull();
  },
};

export const SearchesByName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("supplier-search"), "cahaya", { delay: 40 });

    await waitFor(() => expect(canvas.queryByTestId(`supplier-row-${SUMBER.id}`)).toBeNull());
    await expect(canvas.getByTestId(`supplier-row-${CAHAYA.id}`)).toBeVisible();
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the list is narrowed by it; a change
// is written back; Clear Filters writes them all away in one go (five filters, one navigation — none undoing another).
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/suppliers", element: <><SuppliersPage /><LocationProbe /></> }],
  `/inventories/suppliers?q=cahaya&type=${Marketplace.SHOPEE}`,
);

export const FiltersLiveInTheUrl: Story = {
  parameters: { dataRouter: true },
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByTestId("supplier-search", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(search).toHaveValue("cahaya");
    await expect(canvas.getByTestId("marketplace-select")).toHaveTextContent("Shopee");

    await userEvent.click(await canvas.findByTestId("suppliers-filter-clear"));
    await waitFor(() => expect(location).toBeEmptyDOMElement());
    await expect(search).toHaveValue("");

    await userEvent.type(search, "sumber", { delay: 40 });
    await waitFor(() => expect(location).toHaveTextContent("?q=sumber"));
  },
};

// the-supplier-has-no-code: the form asks for a name, a contact, an address and a description — and nothing else.
export const NewSupplierAsksNoCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-supplier"));
    const name = await screen.findByTestId("supplier-name");
    await waitFor(() => expect(name).toBeVisible());

    await expect(screen.queryByTestId("supplier-code")).toBeNull();
    await expect(screen.queryByTestId("supplier-city")).toBeNull();
    await expect(screen.queryByTestId("supplier-province")).toBeNull();

    // Name is the one required field.
    await expect(screen.getByTestId("submit-supplier")).toBeDisabled();

    await userEvent.type(name, "PT Baru Jaya", { delay: 40 });
    await userEvent.type(screen.getByTestId("supplier-contact"), "0811-7777-8888", { delay: 20 });
    await userEvent.type(screen.getByTestId("supplier-address"), "Jl. Kopo 9, Bandung", { delay: 20 });
    await expect(screen.getByTestId("submit-supplier")).toBeEnabled();
    await userEvent.click(screen.getByTestId("submit-supplier"));

    await waitFor(() => expect(canvas.getByTestId("suppliers-table")).toHaveTextContent("PT Baru Jaya"));
  },
};

// Edit re-opens the record pre-filled, and what is saved is what the row then shows.
export const EditCorrectsTheAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`edit-supplier-${SUMBER.id}`));
    const address = await screen.findByTestId("supplier-address");
    await waitFor(() => expect(address).toHaveValue(SUMBER.address));

    await userEvent.clear(address);
    await userEvent.type(address, "Jl. Kopo 9, Bandung", { delay: 20 });
    await userEvent.click(screen.getByTestId("submit-supplier"));

    await waitFor(() => expect(screen.queryByTestId("supplier-address")).toBeNull());
    await waitFor(() =>
      expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toHaveTextContent("Jl. Kopo 9, Bandung"),
    );
  },
};

// a-deleted-supplier-is-kept-for-its-figures: delete confirms, says past restocks keep the name, and the supplier leaves the list.
export const DeleteKeepsTheHistory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`delete-supplier-${SINAR.id}`));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/past restocks and its figures keep its name/)).toBeVisible();
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByTestId(`supplier-row-${SINAR.id}`)).toBeNull());
  },
};

// only-a-selling-team-has-suppliers: a warehouse team gets no New Supplier, and is told why.
export const OnlyASellingTeamHasSuppliers: Story = {
  beforeEach: standingIn(WAREHOUSE_TEAM),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("suppliers-selling-only", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("open-create-supplier")).toBeNull();
    // No figures, so nothing to filter them by — nor a warehouse to filter by.
    await expect(canvas.queryByTestId("supplier-range-sold")).toBeNull();
    await expect(canvas.queryByTestId("supplier-warehouse-filter")).toBeNull();
  },
};

// ── The screen rules (`the-suppliers-list-follows-the-screen-rules`) ───────────────────────────────

const BANYAK = supplierFixture("PT Banyak Toko");

const rowNames = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("suppliers-table"))
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td p")?.textContent ?? "");

// THE COLUMNS ARE DISCOVER'S, MINUS THE TEAM — the supplier and where it is (two lines), its stores as one badge per
// type, its contact. A deleted store is not a badge (a-store-delete-is-soft-too): PT Sumber Makmur's Lazada is gone.
export const ItsStoresAreBadges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const sumber = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    await expect(sumber).toHaveTextContent("Shopee");
    await expect(sumber).toHaveTextContent("Tokopedia");
    await expect(sumber).not.toHaveTextContent("Lazada");
    await expect(canvas.getByTestId(`supplier-row-${BANYAK.id}`)).toHaveTextContent("×3");
    // A supplier with no store reads a dash, and its address line too.
    await expect(canvas.getByTestId(`supplier-row-${SINAR.id}`)).toHaveTextContent("—");
  },
};

// THE SHARED FILTER STRIP (a-phone-filters-from-a-sheet, clear-filters-is-red-and-bold) — "which of ours sell on
// Lazada?": a live store of the type. Clear, red and bold while anything narrows, puts it back.
export const TheStoreTypeFilters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("suppliers-filter-clear")).toBeNull();
    await userEvent.click(within(canvas.getByTestId("suppliers-type-filter")).getByTestId("marketplace-select"));
    const lazada = await canvas.findByRole("option", { name: "Lazada" });
    await waitFor(() => expect(lazada).toBeVisible());
    await userEvent.click(lazada);

    await waitFor(() => expect(canvas.queryByTestId(`supplier-row-${SUMBER.id}`)).toBeNull());
    await expect(canvas.getByTestId(`supplier-row-${BANYAK.id}`)).toBeVisible();

    const clear = canvas.getByTestId("suppliers-filter-clear");
    await expect(getComputedStyle(clear).fontWeight).toBe("700");
    await userEvent.click(clear);
    await waitFor(() => expect(canvas.getByTestId(`supplier-row-${SUMBER.id}`)).toBeVisible());
  },
};

// THE NAME SORTS FROM ITS HEADING (a-table-sorts-from-its-headings) — the list's own order is newest first; the
// heading starts at A to Z, then flips. The server sorts; a page is never re-sorted here.
export const TheNameSortsFromItsHeading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowNames(canvas)).toEqual(["PT Banyak Toko", "Toko Grosir Sinar", "CV Cahaya Abadi", "PT Sumber Makmur"]);

    await userEvent.click(canvas.getByTestId("supplier-sort-name"));
    await waitFor(() =>
      expect(rowNames(canvas)).toEqual(["CV Cahaya Abadi", "PT Banyak Toko", "PT Sumber Makmur", "Toko Grosir Sinar"]),
    );

    await userEvent.click(canvas.getByTestId("supplier-sort-name"));
    await waitFor(() =>
      expect(rowNames(canvas)).toEqual(["Toko Grosir Sinar", "PT Sumber Makmur", "PT Banyak Toko", "CV Cahaya Abadi"]),
    );
  },
};

// The pages grow as they are opened, as on the accounts list.
export const TheGrowingPager: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("suppliers-pager")).toBeVisible();
  },
};

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (owner: *"hoverable"*, `a-supplier-row-lights-up`) — as the
// account's statement does.
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const ASupplierRowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId(`supplier-row-${SUMBER.id}`);
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// ── Sales and ready stock (`the-supplier-list-shows-sales-and-ready-stock`) ──────────────────────────────────

// SALES AND READY STOCK ARE ON THE LIST, MARKED SAMPLE — two figure columns, each heading carrying its ⚠ number, the
// not-implemented strip naming both; every unit sold with the last order under it, every unit ready with the last
// restock under it (sales-are-all-time-with-their-last-dates); a supplier with no store has nothing to count, so a dash.
export const SalesAndReadyStockAreMarkedSample: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = canvas.getByTestId("suppliers-table");

    const sold = within(table).getByRole("columnheader", { name: /^Sold/ });
    const ready = within(table).getByRole("columnheader", { name: /^Ready/ });
    await expect(within(sold).getByTestId("not-implemented-sold")).toHaveTextContent("1");
    await expect(within(ready).getByTestId("not-implemented-ready")).toHaveTextContent("2");
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();

    await expect(canvas.getByTestId(`supplier-sold-${SUMBER.id}`)).toHaveTextContent(/^[\d.]+ordered \w+ \d+, \d{4}$/);
    await expect(canvas.getByTestId(`supplier-ready-${SUMBER.id}`)).toHaveTextContent(/^[\d.]+restocked \w+ \d+, \d{4}$/);
    await expect(canvas.getByTestId(`supplier-sold-${SINAR.id}`)).toHaveTextContent("—");
    await expect(canvas.getByTestId(`supplier-ready-${SINAR.id}`)).toHaveTextContent("—");
  },
};

// …and on a phone, a line each under the stores — with its mark.
export const APhoneBlockCarriesItsFigures: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const line = canvas.getByTestId(`supplier-row-${SUMBER.id}-figures`);
    await expect(line).toHaveTextContent(/Sold [\d.]+ · ordered .+Ready [\d.]+ · restocked /);
    await expect(within(line).getByTestId("not-implemented-sold")).toBeInTheDocument();
    await expect(canvas.queryByTestId(`supplier-row-${SINAR.id}-figures`)).toBeNull();
  },
};

// THE CONTACT IS RIGHT OF THE SUPPLIER (the-contact-sits-right-of-the-supplier) — Pemasok, Kontak, then the stores and
// the figures.
export const TheContactIsRightOfTheSupplier: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headers = within(canvas.getByTestId("suppliers-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    await expect(headers[0]).toMatch(/^Supplier/);
    await expect(headers[1]).toBe("Contact");
    await expect(headers[2]).toBe("Supplier stores");
  },
};

// ── The figures filter (`supplier-figures-filter-by-range-pills`, `the-figure-filters-are-two-panels`) ──────────

// SOLD AND READY FILTER BY RANGE PILLS, A PANEL EACH — a trigger per figure with its `dropped` mark beside it (3 and 4);
// its panel narrow, the pills wrapping under one another, All first. A pick closes the panel and the trigger then reads
// the band, in the main tone; the list does not move for it. Clear takes both back.
export const TheFiguresFilterIsRangePills: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const soldFilter = canvas.getByTestId("supplier-range-sold");
    const readyFilter = canvas.getByTestId("supplier-range-ready");
    await expect(within(soldFilter).getByTestId("not-implemented-soldRange")).toHaveTextContent("3");
    await expect(within(readyFilter).getByTestId("not-implemented-readyRange")).toHaveTextContent("4");

    const soldTrigger = canvas.getByTestId("supplier-range-sold-trigger");
    await expect(soldTrigger).toHaveTextContent(/^Sold$/);
    await userEvent.click(soldTrigger);
    const panel = await screen.findByTestId("supplier-range-sold-panel");
    await waitFor(() => expect(panel).toBeVisible());
    // Its own panel — Ready's stays shut — and narrow.
    await expect(screen.queryByTestId("supplier-range-ready-panel")).not.toBeVisible();
    await expect(panel.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    await expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All",
      "< 500",
      "500–1.000",
      "1.000–2.500",
      "2.500–5.000",
      "≥ 5.000",
    ]);
    await expect(within(panel).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(within(panel).getByRole("button", { name: "500–1.000" }));
    await waitFor(() => expect(panel).not.toBeVisible());
    await expect(soldTrigger).toHaveTextContent("Sold: 500–1.000");
    // Dropped: every row is still there.
    await expect(rowNames(canvas)).toHaveLength(4);

    await userEvent.click(canvas.getByTestId("suppliers-filter-clear"));
    await waitFor(() => expect(soldTrigger).toHaveTextContent(/^Sold$/));
  },
};

// THE WAREHOUSE IS THE FIRST PICKER (the-warehouse-filters-before-the-team) — right after the search, before the store
// type, where Discover's sits left of its team; its mark (5) beside it, not wired yet. A warehouse team has no list, so
// no warehouse filter either.
export const TheWarehouseIsTheFirstPicker: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const warehouse = canvas.getByTestId("supplier-warehouse-filter");
    await expect(within(warehouse).getByTestId("not-implemented-warehouse")).toHaveTextContent("5");
    await expect(warehouse.getBoundingClientRect().right).toBeLessThanOrEqual(
      canvas.getByTestId("suppliers-type-filter").getBoundingClientRect().left,
    );
    await expect(warehouse.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      canvas.getByTestId("supplier-search").getBoundingClientRect().right,
    );
  },
};

// …and on a phone each stands in the Filter sheet as a label over its pills — no panel inside a panel.
export const APhoneFiltersByRangeInTheSheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("supplier-range-sold-trigger")).toBeNull();
    await userEvent.click(canvas.getByTestId("suppliers-filter-open"));
    const sheet = await screen.findByTestId("suppliers-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());

    const sold = within(sheet).getByTestId("supplier-range-sold");
    await expect(within(sheet).getByTestId("supplier-range-ready")).toBeVisible();
    await userEvent.click(within(sold).getByRole("button", { name: "≥ 5.000" }));
    await expect(within(sheet).getByTestId("suppliers-filter-clear")).toBeVisible();
  },
};
