import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { asRole } from "../../../.storybook/sessionScenario";
import { supplierFixture, supplierFixtures } from "../../../.storybook/supplierFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverSuppliersPage } from "./index";

// Discover Suppliers (discover-searches-every-teams-suppliers): every team's suppliers, searched across teams,
// independent of the Suppliers page (a team's own list). The stub plays supplier_service's SupplierList with the
// EVERY_TEAM scope (supplierStub.ts) — twelve live suppliers kept by three teams, and one deleted.

const Routed = routedPage(
  [
    { path: "/inventories/suppliers/discover", element: <DiscoverSuppliersPage /> },
    marker("/inventories/suppliers/discover/:supplierId", "at-discover-detail"),
    marker("/inventories/suppliers/:supplierId", "at-manage-detail"),
  ],
  "/inventories/suppliers/discover",
);

const SUMBER = supplierFixture("PT Sumber Makmur"); // team 12's — the viewer's own team
const BANYAK = supplierFixture("PT Banyak Toko"); // team 12's — has a Lazada store
const NUSANTARA = supplierFixture("PT Tekstil Nusantara"); // team 15's — has a Lazada store
const LINEN = supplierFixture("Linen House");
const SINAR = supplierFixture("Toko Grosir Sinar"); // team 12's — no store // team 15's — its TikTok store is "linenhouse"
const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // deleted
const LIVE = supplierFixtures.filter((s) => !s.deleted);

const meta = {
  title: "Pages/Suppliers/DiscoverSuppliers",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("discover-suppliers-table")).queryAllByTestId(/^discover-supplier-row-/);

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`discover-supplier-row-${SUMBER.id}`, {}, { timeout: 4000 });
  return canvas;
}

async function search(canvas: ReturnType<typeof within>, term: string) {
  await userEvent.clear(canvas.getByTestId("discover-suppliers-search"));
  await userEvent.type(canvas.getByTestId("discover-suppliers-search"), term, { delay: 40 });
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// A PHONE ALWAYS READS CARDS — one column, the cards are its blocks — so it has no Cards/Table switch.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "cards");
    await expect(canvas.queryByTestId("discover-suppliers-view")).toBeNull();
  },
};

export const TableView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));
    await waitFor(() => expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "table"));
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Across EVERY team — this one's included — each row naming the team that keeps the supplier. Real rows; a deleted
// supplier has left the list. (Only the figures and their filters are marked — see below.)
export const EveryTeamsSuppliers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(LIVE.length));
    for (const team of ["Toko Melati", "Toko Kenanga", "Toko Anggrek"]) {
      await expect(canvas.getByTestId("discover-suppliers-table")).toHaveTextContent(team);
    }
    await expect(canvas.queryByTestId(`discover-supplier-row-${LAMA_TUTUP.id}`)).toBeNull();
  },
};

// The search reads the supplier, its address and contact, and its stores' names — on the server.
export const SearchByStoreOrAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // A store's name — Linen House's TikTok store.
    await search(canvas, "linenhouse");
    await waitFor(() => expect(rows(canvas)).toHaveLength(1));
    await expect(canvas.getByTestId(`discover-supplier-row-${LINEN.id}`)).toBeVisible();

    // An address. The previous answer stays on screen while this one loads (HARD RULE 10) and it, too, is one
    // row — so wait for the row this search is about, not for the count.
    await search(canvas, "pulogadung");
    await canvas.findByTestId(`discover-supplier-row-${NUSANTARA.id}`);
    await waitFor(() => expect(rows(canvas)).toHaveLength(1));

    await search(canvas, "zzz");
    await canvas.findByTestId("discover-suppliers-none-match");
  },
};

// ⚠ supplier_service holds a team id, not a team's name, so the search does not reach the team: "Anggrek" finds
// nothing, though Toko Anggrek's suppliers are on the list. The team is PICKED instead — below.
export const SearchDoesNotReachTheTeamName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await search(canvas, "anggrek");
    await canvas.findByTestId("discover-suppliers-none-match");
  },
};

// "Whose suppliers?" — the Team filter keeps the suppliers one team keeps (discover-filters-by-the-team-that-keeps-it),
// sent to the server as the team's id.
export const FilterByTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const anggrek = teams.find((t) => t.id === 15n)!;

    await pickTeam(canvas.getByTestId("discover-suppliers-team-filter"), anggrek.teamCode);

    const kept = supplierFixtures.filter((s) => !s.deleted && s.teamId === anggrek.id);
    await waitFor(() => expect(rows(canvas)).toHaveLength(kept.length));
    for (const s of kept) {
      await expect(canvas.getByTestId(`discover-supplier-row-${s.id}`)).toBeVisible();
    }
  },
};

// "Who sells on Lazada?" — a supplier with at least one LIVE store of that type. PT Sumber Makmur's Lazada store
// was deleted, so it does not count (a-store-delete-is-soft-too).
export const FilterByChannelType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The store type is a chip (a-store-type-filter-is-chips).
    await userEvent.click(canvas.getByRole("button", { name: "Lazada" }));
    await expect(canvas.getByRole("button", { name: "Lazada" })).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => expect(rows(canvas)).toHaveLength(2));
    await expect(canvas.getByTestId(`discover-supplier-row-${BANYAK.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`discover-supplier-row-${NUSANTARA.id}`)).toBeVisible();
    await expect(canvas.queryByTestId(`discover-supplier-row-${SUMBER.id}`)).toBeNull();
  },
};

// Twelve suppliers at ten a page: two pages.
export const Paginates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-suppliers-pager-size"));
    const ten = await canvas.findByRole("option", { name: "10" });
    await waitFor(() => expect(ten).toBeVisible());
    await userEvent.click(ten);
    await waitFor(() => expect(rows(canvas)).toHaveLength(10));

    await userEvent.click(canvas.getByTestId("discover-suppliers-pager-next"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(LIVE.length - 10));
  },
};

// A row opens the DISCOVER detail — never the manage detail, which carries the owning team's actions.
export const ARowOpensTheDiscoverDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`discover-supplier-row-${NUSANTARA.id}`));
    await canvas.findByTestId("at-discover-detail");
    await expect(canvas.queryByTestId("at-manage-detail")).toBeNull();
  },
};

// ── Cards or a table (`discover-is-cards-or-a-table`, `discover-filters-team-before-store`) ────────────────────────

// CARDS FIRST, a table on a switch — the same rows either way, and the filters and the page carry across.
export const CardsFirstThenATable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "cards");
    await expect(within(canvas.getByTestId("discover-suppliers-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const shown = rows(canvas).length;

    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));
    await waitFor(() => expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "table"));
    await expect(within(canvas.getByTestId("discover-suppliers-table")).getAllByRole("columnheader").length).toBeGreaterThan(0);
    await expect(rows(canvas)).toHaveLength(shown);

    await userEvent.click(canvas.getByTestId("discover-suppliers-view-cards"));
    await waitFor(() => expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "cards"));
  },
};

// A CARD says who the supplier is, whose it is and where it sells — and a store-less one says so in words.
export const ACardReadsTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const card = canvas.getByTestId(`discover-supplier-row-${SUMBER.id}`);
    await expect(card).toHaveTextContent(SUMBER.name);
    await expect(card).toHaveTextContent(SUMBER.address);
    await expect(card).toHaveTextContent("Toko Melati");
    await expect(card).toHaveTextContent("Shopee");
    await expect(card).toHaveTextContent(SUMBER.contact);

    await expect(canvas.getByTestId(`discover-supplier-row-${SINAR.id}`)).toHaveTextContent("No supplier stores yet");
  },
};

// The team filter comes before the store type.
export const TheTeamFilterComesFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const team = canvas.getByTestId("discover-suppliers-team-filter").getBoundingClientRect();
    // The store-type chips are the row under the filters.
    const type = canvas.getByTestId("discover-suppliers-type-filter").getBoundingClientRect();
    await expect(type.top).toBeGreaterThanOrEqual(team.bottom);
  },
};

// THE STORE TYPE IS CHIPS — Semua first and chosen, then every type; one pressed at a time; on a phone they stay out of
// the Filter sheet, one row that scrolls sideways (a-store-type-filter-is-chips).
export const TheStoreTypeIsChips: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const chips = within(canvas.getByTestId("discover-suppliers-type-filter")).getAllByRole("button");

    await expect(chips.map((c) => c.textContent)).toEqual([
      "All",
      "Shopee",
      "Tokopedia",
      "Lazada",
      "TikTok",
      "Blibli",
      "Bukalapak",
      "Other",
    ]);
    await expect(chips[0]).toHaveAttribute("aria-pressed", "true");
  },
};

// A table row lights up under the pointer, every cell (a-table-row-lights-up) — driven by `data-hover`.
export const ATableRowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));

    const row = await canvas.findByTestId(`discover-supplier-row-${SUMBER.id}`);
    await waitFor(() => expect(row.tagName).toBe("TR"));
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// THE CARD READS AS THE OWNER'S REFERENCE (a-discover-card-reads-who-whose-where): the name and where it is, a rule, whose
// it is and where it sells, then the contact with the ↗ at the bottom right — or words when there is no contact.
export const TheCardEndsWithItsContactAndAnArrow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const card = canvas.getByTestId(`discover-supplier-row-${SUMBER.id}`);
    const contact = within(card).getByTestId(`discover-card-contact-${SUMBER.id}`).getBoundingClientRect();
    const arrow = card.querySelector("svg.lucide-arrow-up-right")!.getBoundingClientRect();
    await expect(contact.top).toBeGreaterThan(within(card).getByTestId(`discover-card-address-${SUMBER.id}`).getBoundingClientRect().bottom);
    // The arrow closes the card, bottom right — on the figures' row, under the contact (a-card-reads-its-figures-as-icons).
    await expect(arrow.top).toBeGreaterThanOrEqual(contact.bottom);
    await expect(Math.abs(arrow.right - card.getBoundingClientRect().right)).toBeLessThan(32);

    await expect(canvas.getByTestId(`discover-card-contact-${SINAR.id}`)).toHaveTextContent("No contact yet");
  },
};

// THE TABLE SHOWS THE DESCRIPTION — what the supplier sells, in its own column; a dash when it has none
// (discover-table-shows-the-description).
export const TheTableShowsTheDescription: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));

    await waitFor(() =>
      expect(within(canvas.getByTestId("discover-suppliers-table")).getByRole("columnheader", { name: "Description" })).toBeVisible(),
    );
    await expect(canvas.getByTestId(`discover-table-description-${NUSANTARA.id}`)).toHaveTextContent(NUSANTARA.description);
    await expect(canvas.getByTestId(`discover-table-description-${SINAR.id}`)).toHaveTextContent("—");
  },
};

// ── The supplier list's figures and filters (`discover-shows-the-same-figures-and-filters`) ─────────────────────

// A CARD CARRIES THE FIGURES AS ICONS, ONE ROW, UNDER THE CONTACT (a-card-reads-its-figures-as-icons) — a cart and a
// checked package, each with its units and its mark (1 and 2); no dates. A store-less supplier reads a dash for each,
// unmarked. The strip at the top names them.
export const ACardCarriesTheFigures: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    const row = canvas.getByTestId(`discover-card-figures-${SUMBER.id}`);
    const sold = within(row).getByTestId(`discover-card-figures-${SUMBER.id}-sold`);
    const ready = within(row).getByTestId(`discover-card-figures-${SUMBER.id}-ready`);
    await expect(sold.querySelector("svg.lucide-shopping-cart")).not.toBeNull();
    await expect(ready.querySelector("svg.lucide-package-check")).not.toBeNull();
    // A small pale badge each — the word only for a screen reader and on hover; no dates (a-card-figure-is-a-pale-badge).
    await expect(within(sold).getByTitle("Sold")).toBeVisible();
    await expect(within(ready).getByTitle("Ready")).toBeVisible();
    await expect(row).not.toHaveTextContent(/ordered|restocked/);
    await expect(within(sold).getByTestId("not-implemented-sold")).toHaveTextContent("1");
    await expect(within(ready).getByTestId("not-implemented-ready")).toHaveTextContent("2");
    // One row, under the contact.
    await expect(Math.abs(sold.getBoundingClientRect().top - ready.getBoundingClientRect().top)).toBeLessThan(2);
    const contact = canvas.getByTestId(`discover-card-contact-${SUMBER.id}`).getBoundingClientRect();
    await expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(contact.bottom);

    const none = canvas.getByTestId(`discover-card-figures-${SINAR.id}`);
    await expect(within(none).getByTestId(`discover-card-figures-${SINAR.id}-sold`)).toHaveTextContent("—");
    await expect(within(none).queryByTestId("not-implemented-sold")).toBeNull();
  },
};

// …and the table carries them last, at the right edge, as the supplier list does — a dash for a store-less supplier.
export const TheTableCarriesTheFiguresLast: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("discover-suppliers-view-table"));
    await waitFor(() => expect(canvas.getByTestId("discover-suppliers-table")).toHaveAttribute("data-view", "table"));

    const headers = within(canvas.getByTestId("discover-suppliers-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    await expect(headers.at(-2)).toMatch(/^Sold/);
    await expect(headers.at(-1)).toMatch(/^Ready/);
    await expect(canvas.getByTestId(`discover-sold-${SUMBER.id}`)).toHaveTextContent(/^[\d.]+ordered \w+ \d+, \d{4}$/);
    await expect(canvas.getByTestId(`discover-ready-${SUMBER.id}`)).toHaveTextContent(/^[\d.]+restocked \w+ \d+, \d{4}$/);
    await expect(canvas.getByTestId(`discover-sold-${SINAR.id}`)).toHaveTextContent("—");
  },
};

// THE SAME RANGE FILTERS — Terjual and Siap after the team, a panel each, marked 3 and 4. A pick is held, the trigger
// reads the band, and the cards do not move for it; Clear takes it back.
export const TheFiguresFilterByRangePills: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(rows(canvas)).toHaveLength(Math.min(LIVE.length, 20)));
    const before = rows(canvas).length;

    await expect(within(canvas.getByTestId("supplier-range-sold")).getByTestId("not-implemented-soldRange")).toHaveTextContent("3");
    await expect(within(canvas.getByTestId("supplier-range-ready")).getByTestId("not-implemented-readyRange")).toHaveTextContent("4");
    const team = canvas.getByTestId("discover-suppliers-team-filter").getBoundingClientRect();
    await expect(canvas.getByTestId("supplier-range-sold").getBoundingClientRect().left).toBeGreaterThan(team.left);

    await userEvent.click(canvas.getByTestId("supplier-range-ready-trigger"));
    const panel = await screen.findByTestId("supplier-range-ready-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await userEvent.click(within(panel).getByRole("button", { name: "100–250" }));
    await expect(canvas.getByTestId("supplier-range-ready-trigger")).toHaveTextContent("Ready: 100–250");
    await expect(rows(canvas)).toHaveLength(before);

    await userEvent.click(canvas.getByTestId("discover-suppliers-filter-clear"));
    await waitFor(() => expect(canvas.getByTestId("supplier-range-ready-trigger")).toHaveTextContent(/^Ready$/));
  },
};

// THE WAREHOUSE FILTERS BEFORE THE TEAM (the-warehouse-filters-before-the-team) — right after the search, left of the
// team, its mark (5) beside it: not wired yet.
export const TheWarehouseFiltersBeforeTheTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const warehouse = canvas.getByTestId("supplier-warehouse-filter");
    await expect(within(warehouse).getByTestId("not-implemented-warehouse")).toHaveTextContent("5");
    await expect(within(warehouse).getByRole("combobox")).toHaveAttribute("placeholder", "All warehouses");
    const team = canvas.getByTestId("discover-suppliers-team-filter").getBoundingClientRect();
    const search = canvas.getByTestId("discover-suppliers-search").getBoundingClientRect();
    await expect(warehouse.getBoundingClientRect().right).toBeLessThanOrEqual(team.left);
    await expect(warehouse.getBoundingClientRect().left).toBeGreaterThanOrEqual(search.right);
  },
};

// …and on a phone they stand in the Filter sheet, under the team.
export const APhoneFiltersByRangeInTheSheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-suppliers-filter-open"));
    const sheet = await screen.findByTestId("discover-suppliers-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("discover-suppliers-team-filter")).toBeVisible();
    // The warehouse first, then the team, as on a desktop.
    const warehouse = within(sheet).getByTestId("supplier-warehouse-filter").getBoundingClientRect();
    await expect(warehouse.bottom).toBeLessThanOrEqual(
      within(sheet).getByTestId("discover-suppliers-team-filter").getBoundingClientRect().top,
    );
    await expect(within(sheet).getByTestId("supplier-range-sold")).toBeVisible();
    await expect(within(sheet).getByTestId("supplier-range-ready")).toBeVisible();
  },
};
