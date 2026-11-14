import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam } from "../../../.storybook/sessionScenario";
import { supplierExportScenario } from "../../../.storybook/supplierExportScenario";
import { supplierGoodsCalls } from "../../../.storybook/supplierGoodsStub";
import { channelFixture, supplierFixture } from "../../../.storybook/supplierFixtures";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { ChannelBrowser } from "./ChannelBrowser";

// A supplier's Channels tab, shared by the manage detail (with its actions) and the discover detail (read-only)
// — supplier-detail-has-channels-and-products-tabs. It reads its own page from SupplierChannelList, which searches,
// filters by type and pages on the server (the stub plays it: supplierStub.ts). Each store's Terjual and Siap are real —
// InventoryService.SupplierGoods by store (supplierGoodsStub.ts).

const SUMBER = supplierFixture("PT Sumber Makmur"); // team 12's — three live stores and a deleted one
const SINAR = supplierFixture("Toko Grosir Sinar"); // no stores
const BANYAK = supplierFixture("PT Banyak Toko"); // twelve stores — more than a page
const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's

const SHOPEE_STORE = channelFixture(311n);
const TOKOPEDIA_STORE = channelFixture(312n);
const WEBSITE = channelFixture(313n);
const DELETED_STORE = channelFixture(314n);

const TEAM = 12n;

const meta = {
  title: "Features/Suppliers/ChannelBrowser",
  component: ChannelBrowser,
  args: { teamId: TEAM, supplierId: SUMBER.id },
} satisfies Meta<typeof ChannelBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("channels-table", {}, { timeout: 4000 });
  return canvas;
}

const rows = (canvas: ReturnType<typeof within>) => within(canvas.getByTestId("channels-table")).getAllByRole("row");

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const ReadOnly: Story = {};

export const WithActions: Story = {
  args: {
    actions: <Button size="xs">Add Store</Button>,
    rowActions: () => <Button size="xs" variant="ghost">Edit</Button>,
  },
};

export const Empty: Story = { args: { supplierId: SINAR.id } };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-detail-tabs-show-sold-and-ready: each store's Terjual (the last order under it) and Siap (the last restock under
// it) are what was bought there — real, so unmarked. A store whose goods never sold reads 0 with no order date.
export const EachStoreReadsItsGoods: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`channel-sold-${SHOPEE_STORE.id}`)).toHaveTextContent(/^1\.204ordered /));
    await expect(canvas.getByTestId(`channel-ready-${SHOPEE_STORE.id}`)).toHaveTextContent(/^86restocked /);
    await expect(canvas.getByTestId(`channel-sold-${TOKOPEDIA_STORE.id}`)).toHaveTextContent(/^303ordered /);
    await expect(canvas.getByTestId(`channel-sold-${WEBSITE.id}`)).toHaveTextContent(/^0$/);
    await expect(canvas.getByTestId(`channel-ready-${WEBSITE.id}`)).toHaveTextContent(/^40restocked /);
    await expect(canvas.queryByTestId("not-implemented-sold")).toBeNull();
  },
};

// A store none of whose goods ever arrived reads a dash for each.
export const AStoreNeverBoughtFromIsADash: Story = {
  args: { supplierId: MAKMUR_JAYA.id },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("channel-sold-341")).toHaveTextContent(/^2\.579ordered /));
    await expect(canvas.getByTestId("channel-sold-342")).toHaveTextContent("—");
    await expect(canvas.getByTestId("channel-ready-342")).toHaveTextContent("—");
  },
};

// Read-only means no Actions column at all, not an empty one.
export const ReadOnlyHasNoActionsColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(within(canvas.getByTestId("channels-table")).queryByText("Actions")).toBeNull();
  },
};

// a-store-delete-is-soft-too: a deleted store is not on the list.
export const ADeletedStoreIsNotListed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 3));
    await expect(canvas.queryByTestId(`channel-row-${DELETED_STORE.id}`)).toBeNull();
  },
};

// The search reads a store's name, its link AND its description.
export const SearchesNameLinkAndDescription: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("channels-search"), "tokopedia.com", { delay: 40 });
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeVisible();

    // "Cigondewah" is only in the website's description. The rows on screen are kept while the next answer
    // loads (HARD RULE 10), so wait for the answer itself, not for a count the previous one already had.
    await userEvent.clear(canvas.getByTestId("channels-search"));
    await userEvent.type(canvas.getByTestId("channels-search"), "cigondewah", { delay: 40 });
    await canvas.findByTestId(`channel-row-${WEBSITE.id}`);
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));

    // Nothing matching says so, rather than reading as "no channels".
    await userEvent.clear(canvas.getByTestId("channels-search"));
    await userEvent.type(canvas.getByTestId("channels-search"), "zzz", { delay: 40 });
    await canvas.findByTestId("channels-none-match");
  },
};

export const FiltersByType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(within(canvas.getByTestId("channels-type-filter")).getByTestId("marketplace-select"));
    const option = await canvas.findByRole("option", { name: "Tokopedia" });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.queryByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeNull());
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeVisible();
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url), `store.`-prefixed so the detail page's other tabs keep
// theirs — opened at a URL, the search and the type are read from it; a change is written back.
const AtFilteredUrl = routedPage(
  [
    {
      path: "/inventories/suppliers/:supplierId",
      element: (
        <>
          <ChannelBrowser teamId={TEAM} supplierId={SUMBER.id} />
          <LocationProbe />
        </>
      ),
    },
  ],
  `/inventories/suppliers/${SUMBER.id}?store.q=tokopedia&store.type=${Marketplace.TOKOPEDIA}`,
);

export const FiltersLiveInTheUrl: Story = {
  parameters: { dataRouter: true },
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");
    const type = within(canvas.getByTestId("channels-type-filter")).getByTestId("marketplace-select");

    await expect(canvas.getByTestId("channels-search")).toHaveValue("tokopedia");
    await expect(type).toHaveTextContent("Tokopedia");
    await canvas.findByTestId(`channel-row-${TOKOPEDIA_STORE.id}`);

    await userEvent.click(type);
    const shopee = await canvas.findByRole("option", { name: "Shopee" });
    await waitFor(() => expect(shopee).toBeVisible());
    await userEvent.click(shopee);
    await waitFor(() => expect(location).toHaveTextContent(`store.type=${Marketplace.SHOPEE}`));
    await expect(location).toHaveTextContent("store.q=tokopedia");
  },
};

// Twelve stores at ten a page: two pages, newest first.
export const Paginates: Story = {
  args: { supplierId: BANYAK.id },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 10));
    await userEvent.click(canvas.getByTestId("channels-pager-next"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 2));
    await expect(canvas.getByTestId("channel-row-351")).toBeVisible();
  },
};

// Reads cross teams: team 12 reads team 13's supplier's stores.
export const AnotherTeamsStoresAreReadable: Story = {
  args: { supplierId: MAKMUR_JAYA.id },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 2));
    await expect(canvas.getByTestId("channels-table")).toHaveTextContent("Makmur Jaya Grosir");
  },
};

// A ROW LIGHTS UP under the pointer, every cell of it (a-supplier-tab-row-lights-up) — driven by `data-hover`, which
// Chakra's `_hover` honours; a synthetic pointer sets no CSS `:hover`.
export const AStoreRowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = within(await canvas.findByTestId("channels-table")).getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// THE TAB AS A FILE (each-supplier-tab-exports-its-own-table): Export asks for the rows the list holds with ITS filter —
// the settled search and the type, every page — and the file downloads as the stream ends.
export const ExportsTheTabAsFiltered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("channels-search"), "tokopedia.com", { delay: 40 });
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));

    await userEvent.click(canvas.getByTestId("channels-export"));

    await waitFor(() => expect(supplierExportScenario.stores).toHaveLength(1));
    const asked = supplierExportScenario.stores[0]!;
    await expect(asked).toMatchObject({ teamId: TEAM, supplierId: SUMBER.id, q: "tokopedia.com", rows: 1 });
    await expect((await screen.findAllByText("Export ready — the file is downloading")).length).toBeGreaterThan(0);
  },
};

// A monitored team is read, never written — and an export stores a file (the-admin-team-monitors-read-only).
export const AMonitorHasNoExport: Story = {
  parameters: { signedIn: true },
  beforeEach: [asAdminTeam(), asTeam(TEAM)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("channels-export")).toBeNull();
  },
};

// ── Under the page's warehouse chip (`a-supplier-page-is-scoped-by-its-warehouses`) ──────────────────────────

const GUDANG_PUSAT = 11n;
const GUDANG_CABANG = 14n;

// A chip picked on the page narrows the tab ON THE SERVER: only the stores whose goods were received at that warehouse —
// Gudang Cabang holds only the Tokopedia store's — and each reads what its goods did THERE (SupplierGoods asked with the
// warehouse).
export const AWarehouseNarrowsTheStores: Story = {
  args: { warehouseId: GUDANG_CABANG },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeVisible();
    await expect(canvas.queryByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeNull();
    await waitFor(() => expect(canvas.getByTestId(`channel-sold-${TOKOPEDIA_STORE.id}`)).toHaveTextContent(/^303ordered /));
    await expect(supplierGoodsCalls.at(-1)).toMatchObject({ supplierIds: [SUMBER.id], warehouseId: GUDANG_CABANG });
  },
};

// …and its Export writes the tab as narrowed — the chip goes with the search and the type.
export const ExportsUnderTheChip: Story = {
  args: { warehouseId: GUDANG_PUSAT },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 2));
    await userEvent.click(canvas.getByTestId("channels-export"));

    await waitFor(() => expect(supplierExportScenario.stores).toHaveLength(1));
    await expect(supplierExportScenario.stores[0]).toMatchObject({ supplierId: SUMBER.id, warehouseId: GUDANG_PUSAT, rows: 2 });
  },
};

// A chip none of whose stores had goods received there says so — not "no stores yet" — and offers every warehouse back.
export const NothingAtTheWarehouseOffersAll: Story = {
  args: { warehouseId: 99n, onClearWarehouse: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    const hint = await canvas.findByTestId("channels-none-at-warehouse", {}, { timeout: 4000 });
    await expect(hint).toHaveTextContent("No supplier stores at this warehouse.");
    await expect(canvas.queryByTestId("channels-empty")).toBeNull();

    await userEvent.click(within(hint).getByRole("button", { name: "All Warehouses" }));
    await expect(args.onClearWarehouse).toHaveBeenCalledOnce();
  },
};
