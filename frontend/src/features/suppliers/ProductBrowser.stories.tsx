import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam } from "../../../.storybook/sessionScenario";
import { supplierExportScenario } from "../../../.storybook/supplierExportScenario";
import { channelFixtures, supplierFixture } from "../../../.storybook/supplierFixtures";
import type { SupplierChannelRecord } from "./adapt";
import { ProductBrowser } from "./ProductBrowser";
import { formatUnixDate } from "../../lib/datetime";

// A supplier's Products tab, shared by the manage and discover details (supplier-detail-has-channels-and-products-tabs).
// It reads its own page from SupplierChannelService.SupplierProductList, which searches, narrows by team and store and
// pages on the server, names each product and fills its store × product Terjual and Siap — the stub plays it over
// supplierProductFixtures.ts (supplierStub.ts).

const SUMBER = supplierFixture("PT Sumber Makmur"); // team 12's — five products, one with no store
const SINAR = supplierFixture("Toko Grosir Sinar"); // nothing bought from it
const BANYAK = supplierFixture("PT Banyak Toko"); // 24 products — three pages
const NUSANTARA = supplierFixture("PT Tekstil Nusantara"); // team 15's — read from another team

const TEAM = 12n;

// A supplier's live stores, as the page hands them to the tab's store filter.
const storesOf = (supplierId: bigint): SupplierChannelRecord[] =>
  channelFixtures.filter((c) => c.supplierId === supplierId && !c.deleted).map(({ deleted: _deleted, ...c }) => c);

// The stub's dates are days before now — the same arithmetic, so a story reads the date the row shows.
const daysAgo = (days: number) => formatUnixDate(BigInt(Math.floor(Date.now() / 1000)) - BigInt(days) * 86_400n);

const meta = {
  title: "Features/Suppliers/ProductBrowser",
  component: ProductBrowser,
  args: { teamId: TEAM, supplierId: SUMBER.id, channels: storesOf(SUMBER.id) },
} satisfies Meta<typeof ProductBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("products-table", {}, { timeout: 4000 });
  return canvas;
}

const rows = (canvas: ReturnType<typeof within>) => within(canvas.getByTestId("products-table")).getAllByRole("row");

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// Nothing bought from it yet — the hint says when products come.
export const Empty: Story = {
  args: { supplierId: SINAR.id, channels: [] },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByTestId("products-empty", {}, { timeout: 4000 });
  },
};

// ── A row (`a-supplier-product-row-says-whose-where-and-when`) ──────────────────────────────────────────────

// Each product names the store it was bought at (products-hang-off-a-channel), newest restock first
// (a-link-remembers-its-last-restock).
export const ProductsNameTheirStoreNewestFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rows(canvas).slice(1).map((row) => row.getAttribute("data-testid"))).toEqual([
      "product-row-3101",
      "product-row-3102",
      "product-row-3103",
      "product-row-3104",
      "product-row-3105",
    ]);
    await expect(canvas.getByTestId("product-row-3101-store")).toHaveTextContent("Sumber Makmur Official");
    await expect(canvas.getByTestId("product-row-3103-store")).toHaveTextContent("Sumber Makmur Store");
  },
};

// A ROW SAYS WHOSE, WHERE AND WHEN — the product with its picture and its SKU under its name, the team whose product
// it is, the store it was bought at (its name, its type under it), the last restock and the first under it.
export const ARowSaysWhoseWhereAndWhen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const row = canvas.getByTestId("product-row-3101");

    await expect(within(row).getByRole("img")).toBeInTheDocument();
    await expect(row).toHaveTextContent("Kain Katun Jepang 1 rol");
    await expect(row).toHaveTextContent("KTN-JP-01");
    await waitFor(() => expect(row).toHaveTextContent("Toko Melati"));
    await expect(row).toHaveTextContent(daysAgo(2));
    await expect(row).toHaveTextContent(`first ${daysAgo(40)}`);

    const store = within(row).getByText("Sumber Makmur Official").getBoundingClientRect();
    await expect(within(row).getByTestId(/^marketplace-badge-/).getBoundingClientRect().top).toBeGreaterThanOrEqual(store.bottom);
  },
};

// BOUGHT WITH NO STORE — a restock line named the supplier alone: its Toko reads a dash
// (a-line-with-no-store-links-under-the-supplier).
export const NoStoreReadsADash: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("product-row-3104-store")).toHaveTextContent(/^—$/);
    await expect(canvas.getByTestId("product-row-3104")).toHaveTextContent("KCG-12");
  },
};

// Bought once, it is one date — no "first" repeating the last.
export const BoughtOnceIsOneDate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("product-row-3102")).toHaveTextContent(daysAgo(5));
    await expect(canvas.getByTestId("product-row-3102")).not.toHaveTextContent("first");
  },
};

// Two teams buying at one store are two rows, each naming its own team (every-accepted-line-links-its-own-product).
export const EachRowNamesItsTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("product-row-3101")).toHaveTextContent("Toko Melati"));
    await expect(canvas.getByTestId("product-row-3102")).toHaveTextContent("Toko Kenanga");
  },
};

// A product with no picture shows the placeholder, not an empty box.
export const NoPictureIsAPlaceholder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(within(canvas.getByTestId("product-row-3104")).queryByRole("img")).toBeNull();
  },
};

// ITS TERJUAL AND SIAP (the-detail-tabs-show-sold-and-ready) — the store × product's, the last order under Terjual, no
// restock date under Siap: Last bought, just left of it, is that date. Never sold reads 0 with no order date; a product
// none of whose goods arrived reads a dash. Real — no mark.
export const ItsSoldAndReady: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headers = within(canvas.getByTestId("products-table")).getAllByRole("columnheader");

    await expect(headers.at(-2)).toHaveTextContent(/^Sold$/);
    await expect(headers.at(-1)).toHaveTextContent(/^Ready$/);
    await expect(canvas.getByTestId("product-sold-3101")).toHaveTextContent(/^412ordered /);
    await expect(canvas.getByTestId("product-ready-3101")).toHaveTextContent(/^37$/);
    await expect(canvas.getByTestId("product-sold-3102")).toHaveTextContent(/^0$/);
    await expect(canvas.getByTestId("product-ready-3102")).toHaveTextContent(/^24$/);
    await expect(canvas.getByTestId("product-sold-3105")).toHaveTextContent("—");
    await expect(canvas.queryByTestId("not-implemented-sold")).toBeNull();
  },
};

// On a phone a product is a block: the product with its team beside the SKU, the store, when, then its figures.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const block = await within(canvasElement).findByTestId("product-row-3101", {}, { timeout: 4000 });
    await waitFor(() => expect(block).toHaveTextContent("Toko Melati"));
    // The first restock on its OWN line, under the last — never wrapped onto it (the-first-restock-has-its-own-line).
    const last = within(block).getByTestId("product-row-3101-last").getBoundingClientRect();
    const first = within(block).getByTestId("product-row-3101-first").getBoundingClientRect();
    await expect(first.top).toBeGreaterThanOrEqual(last.bottom);
    await expect(within(block).getByTestId("product-row-3101-figures")).toHaveTextContent(/^Sold 412 · ordered .+Ready 37$/);
    await expect(within(canvasElement).getByTestId("product-row-3104-store")).toHaveTextContent("—");
  },
};

// ── Search and pages (`the-products-tab-searches-and-pages`) ─────────────────────────────────────────────────

// The product's name or SKU (product_service's match), or the store it was bought at.
export const SearchesProductCodeOrStore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const search = canvas.getByTestId("products-search");

    await userEvent.type(search, "KTN", { delay: 30 });
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));
    await expect(canvas.getByTestId("product-row-3101")).toBeVisible();

    // The old term REPLACED in one input event (select all, paste) — not cleared, then typed: the search is debounced,
    // and under load the empty box or a short prefix settles first, which lists 3103 among others, so the wait below
    // passed on it and the one-row count read the stale rows. Pasted, the only new term is the store's whole name.
    await userEvent.click(search);
    await userEvent.keyboard("{Control>}a{/Control}");
    await userEvent.paste("Sumber Makmur Store");
    // The previous answer (one row) stays up while the next loads — wait for THIS one's row.
    await waitFor(() => expect(canvas.getByTestId("product-row-3103")).toBeVisible());
    await expect(rows(canvas)).toHaveLength(1 + 1);

    await userEvent.clear(search);
    await userEvent.type(search, "zzz", { delay: 30 });
    await canvas.findByTestId("products-none-match");
  },
};

// Twenty-four products at ten a page: three pages, the last one back in a click.
export const Paginates: Story = {
  args: { supplierId: BANYAK.id, channels: storesOf(BANYAK.id) },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 10));
    await userEvent.click(canvas.getByTestId("products-pager-next"));
    await userEvent.click(canvas.getByTestId("products-pager-next"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 4));

    // every-list-pages-with-the-growing-pager: page 1 is one click back, not two.
    await userEvent.click(canvas.getByTestId("products-pager-page-1"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 10));
  },
};

// Reads cross teams: Toko Melati reads Toko Anggrek's supplier's products — every team's, each with its figures
// (another-team-sees-everything-of-a-supplier, every-selling-team-sees-every-teams-figures).
export const AnotherTeamsSupplierReadsInFull: Story = {
  args: { supplierId: NUSANTARA.id, channels: storesOf(NUSANTARA.id) },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 2));
    await waitFor(() => expect(canvas.getByTestId("product-row-3602")).toHaveTextContent("Toko Anggrek"));
    await expect(canvas.getByTestId("product-sold-3602")).toHaveTextContent(/^33ordered /);
    await expect(canvas.getByTestId("product-ready-3602")).toHaveTextContent(/^7$/);
  },
};

// ── The filters, Tim then Toko (`the-products-tab-filters-by-team-and-store`) ──────────────────────────────────

async function pickStore(canvas: ReturnType<typeof within>, value: string) {
  await userEvent.click(canvas.getByTestId("products-store"));
  const option = await canvas.findByTestId(`products-store-option-${value}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// ONE STORE — a search select over the supplier's own stores: only what was bought there stays.
export const FiltersByStore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickStore(canvas, "312");
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));
    await expect(canvas.getByTestId("product-row-3103")).toBeVisible();
  },
};

// NO STORE — the products bought with none, the rows whose Toko reads "—".
export const FiltersByNoStore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickStore(canvas, "none");
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));
    await expect(canvas.getByTestId("product-row-3104-store")).toHaveTextContent("—");
    await expect(canvas.getByTestId("products-store")).toHaveValue("No store");
  },
};

// ONE TEAM — the Statistik tab's picker. Its products only, and the Team column goes: it would repeat one name.
export const FiltersByTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickTeam(canvas.getByTestId("products-team-filter"), "SL-02");

    await waitFor(() => expect(canvas.queryByTestId("product-row-3101")).toBeNull());
    await expect(rows(canvas)).toHaveLength(1 + 2);
    await expect(canvas.getByTestId("product-row-3102")).toHaveTextContent("BNG-PL-40");
    await expect(within(canvas.getByTestId("products-table")).queryByRole("columnheader", { name: "Team" })).toBeNull();
  },
};

// Clear puts every filter back.
export const ClearPutsEveryFilterBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickTeam(canvas.getByTestId("products-team-filter"), "SL-02");
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 2));

    await userEvent.click(canvas.getByTestId("products-filter-clear"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 5));
    await expect(within(canvas.getByTestId("products-table")).getByRole("columnheader", { name: "Team" })).toBeVisible();
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url), `product.`-prefixed so the detail page's other tabs
// keep theirs — opened at a URL, the store is read from it ("none" for no store); a search typed is written back.
function atUrl(search: string) {
  return routedPage(
    [
      {
        path: "/inventories/suppliers/:supplierId",
        element: (
          <>
            <ProductBrowser teamId={TEAM} supplierId={SUMBER.id} channels={storesOf(SUMBER.id)} />
            <LocationProbe />
          </>
        ),
      },
    ],
    `/inventories/suppliers/${SUMBER.id}${search}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const AtStoreUrl = atUrl("?product.store=312");
const AtNoStoreUrl = atUrl("?product.store=none");

export const FiltersLiveInTheUrl: Story = {
  parameters: { dataRouter: true },
  render: () => <AtStoreUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    await waitFor(() => expect(canvas.getByTestId("products-store")).toHaveValue("Sumber Makmur Store"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));

    await userEvent.type(canvas.getByTestId("products-search"), "rayon", { delay: 40 });
    await waitFor(() => expect(location).toHaveTextContent("product.q=rayon"));
    await expect(location).toHaveTextContent("product.store=312");
  },
};

export const NoStoreLivesInTheUrl: Story = {
  parameters: { dataRouter: true },
  render: () => <AtNoStoreUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("products-store")).toHaveValue("No store"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));
    await expect(canvas.getByTestId("product-row-3104")).toBeVisible();
  },
};

// Tim, then Toko — the order of the table's columns.
export const TeamComesBeforeStore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const team = canvas.getByTestId("products-team-filter").getBoundingClientRect();
    const store = canvas.getByTestId("products-store-filter").getBoundingClientRect();
    await expect(team.left).toBeLessThan(store.left);
  },
};

// A ROW LIGHTS UP under the pointer, every cell of it (a-supplier-tab-row-lights-up) — driven by `data-hover`.
export const AProductRowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const row = canvas.getByTestId("product-row-3101");
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// ── The tab as a file (`each-supplier-tab-exports-its-own-table`) ────────────────────────────────────────────

// Export asks for the rows the list holds with ITS filter — the settled search, the team, the store or "no store", every
// page — and the file downloads as the stream ends.
export const ExportsTheTabAsFiltered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickTeam(canvas.getByTestId("products-team-filter"), "SL-02");
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 2));

    await userEvent.click(canvas.getByTestId("products-export"));

    await waitFor(() => expect(supplierExportScenario.products).toHaveLength(1));
    await expect(supplierExportScenario.products[0]).toMatchObject({
      teamId: TEAM,
      supplierId: SUMBER.id,
      productTeamId: 13n,
      storeId: 0n,
      noStore: false,
      rows: 2,
    });
    await expect((await screen.findAllByText("Export ready — the file is downloading")).length).toBeGreaterThan(0);
  },
};

// "No store" goes to the server as itself — never as a store id.
export const ExportsTheNoStoreRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickStore(canvas, "none");
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));
    await userEvent.click(canvas.getByTestId("products-export"));

    await waitFor(() => expect(supplierExportScenario.products).toHaveLength(1));
    await expect(supplierExportScenario.products[0]).toMatchObject({ storeId: 0n, noStore: true, rows: 1 });
  },
};

// A monitored team is read, never written — and an export stores a file (the-admin-team-monitors-read-only).
export const AMonitorHasNoExport: Story = {
  parameters: { signedIn: true },
  beforeEach: [asAdminTeam(), asTeam(TEAM)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("products-export")).toBeNull();
  },
};

// ── Under the page's warehouse chip (`a-supplier-page-is-scoped-by-its-warehouses`) ──────────────────────────

const GUDANG_CABANG = 14n;

// A chip picked on the page narrows the tab ON THE SERVER: only the rows whose goods were received at that warehouse —
// at Gudang Cabang the Tokopedia row and the store-less one — with that warehouse's Terjual and Siap.
export const AWarehouseNarrowsTheProducts: Story = {
  args: { warehouseId: GUDANG_CABANG },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(rows(canvas).slice(1).map((row) => row.getAttribute("data-testid"))).toEqual([
        "product-row-3103",
        "product-row-3104",
      ]),
    );
    await expect(canvas.getByTestId("product-row-3104-store")).toHaveTextContent("—");
  },
};

// …and its Export writes the tab as narrowed — the chip goes with the search, the team and the store.
export const ExportsUnderTheChip: Story = {
  args: { warehouseId: GUDANG_CABANG },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 2));
    await userEvent.click(canvas.getByTestId("products-export"));

    await waitFor(() => expect(supplierExportScenario.products).toHaveLength(1));
    await expect(supplierExportScenario.products[0]).toMatchObject({
      supplierId: SUMBER.id,
      warehouseId: GUDANG_CABANG,
      rows: 2,
    });
  },
};

// A chip none of whose products had goods received there says so — not "no products yet" — and offers every warehouse
// back.
export const NothingAtTheWarehouseOffersAll: Story = {
  args: { warehouseId: 99n, onClearWarehouse: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const hint = await canvas.findByTestId("products-none-at-warehouse", {}, { timeout: 4000 });
    await expect(hint).toHaveTextContent("No products at this warehouse.");
    await expect(canvas.queryByTestId("products-empty")).toBeNull();

    await userEvent.click(within(hint).getByRole("button", { name: "All Warehouses" }));
    await expect(args.onClearWarehouse).toHaveBeenCalledOnce();
  },
};
