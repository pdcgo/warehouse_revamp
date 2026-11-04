import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam, asPlatformOnly, asRole } from "../../../.storybook/sessionScenario";
import { warehouseStockNothingHeld } from "../../../.storybook/warehouseStockListStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ROOT_TEAM_ID } from "../../features/team/TeamContext";
import { InventoryPage } from "./index";

// ROOT AND THE ADMIN TEAM'S INVENTORY (/inventory): a warehouse picked, and what it holds — every product with a batch in
// that warehouse, any team's, at 0 or not, archived ones labelled, each with its owner team and its units on hand;
// searched by name or code on the server (the-stock-screen-lists-what-the-warehouse-has-held). warehouseStockListStub.ts
// plays the server's rules, reading the same batch registers the warehouse picker searches. A warehouse reads the same
// list as its own Products (pages/products, a-warehouses-products-is-what-it-holds); here a row opens nothing.
//
// Gudang Pusat (11) — the signed-in person is its Admin, so the page opens on it:
//
//   Beras Pandan Wangi 5kg                  SKU-BERAS-5K      Toko Melati    8
//   Gula Pasir 1kg                          SKU-GULA-1K       Toko Kenanga  12
//   Minyak Goreng Sawit 2L — Karton         SL-03-ANG-002     Toko Anggrek   0   held, emptied
//   Minyak Goreng Sawit 2L — Kemasan Lama   SL-03-ANG-001-L   Toko Anggrek   0   ARCHIVED by its seller
//   Minyak Goreng Sawit 2L — Satuan         SL-03-ANG-001     Toko Anggrek   6
//   Tepung Terigu Serbaguna 1kg — Karton    SL-03-ANG-004     Toko Anggrek   0   held, emptied
//   Tepung Terigu Serbaguna 1kg — Satuan    SL-03-ANG-003     Toko Anggrek   4
//
// Kopi Arabika and Teh Melati are the WAREHOUSE TEAM's own catalogue (team 11) and were never stocked here: the old
// screen listed exactly them; this one never does.

const route = (entry: string) =>
  routedPage(
    [
      {
        path: "/inventory",
        element: (
          <>
            <InventoryPage />
            <LocationProbe />
          </>
        ),
      },
      marker("/inventories/products/:productId", "at-warehouse-product"),
    ],
    entry,
  );

const Routed = route("/inventory");
// Gudang Cabang (14), picked in the URL — how a monitor or Root opens another building's stock.
const RoutedCabang = route("/inventory?warehouse=14");

const meta = {
  title: "Pages/Inventory/Inventory",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const GUDANG_PUSAT = [
  "SKU-BERAS-5K",
  "SKU-GULA-1K",
  "SL-03-ANG-002",
  "SL-03-ANG-001-L",
  "SL-03-ANG-001",
  "SL-03-ANG-004",
  "SL-03-ANG-003",
];

async function loaded(canvasElement: HTMLElement, first = "stock-row-SKU-BERAS-5K") {
  const canvas = within(canvasElement);
  await canvas.findByTestId(first, {}, { timeout: 4000 });
  return canvas;
}

const listed = (canvas: ReturnType<typeof within>) =>
  canvas.getAllByTestId(/^stock-row-/).map((el: HTMLElement) => el.dataset.testid!.replace("stock-row-", ""));

async function search(canvas: ReturnType<typeof within>, text: string) {
  const box = canvas.getByTestId("inventory-search");
  await userEvent.clear(box);
  if (text !== "") await userEvent.type(box, text, { delay: 40 });
}

// Every product held here, by name — other teams' goods, each with its owner and its units on hand. Never the
// warehouse team's own catalogue.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(listed(canvas)).toEqual(GUDANG_PUSAT);

    await expect(canvas.getByTestId("stock-owner-SKU-BERAS-5K")).toHaveTextContent("Toko Melati");
    await expect(canvas.getByTestId("stock-owner-SKU-GULA-1K")).toHaveTextContent("Toko Kenanga");
    await expect(canvas.getByTestId("stock-owner-SL-03-ANG-001")).toHaveTextContent("Toko Anggrek");

    await expect(canvas.getByTestId("stock-onhand-SKU-BERAS-5K")).toHaveTextContent("8");
    await expect(canvas.getByTestId("stock-onhand-SKU-GULA-1K")).toHaveTextContent("12");
    await expect(canvas.getByTestId("stock-onhand-SL-03-ANG-001")).toHaveTextContent("6");

    // The warehouse team's own catalogue, never stocked here, is not the list.
    await expect(canvas.queryByTestId("stock-row-SKU-KOPI-250")).toBeNull();
    await expect(canvas.queryByTestId("stock-row-SKU-TEH-100")).toBeNull();

    await expect(canvas.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(canvas.getByText("Every product this warehouse holds or has held — any team's, at 0 too.")).toBeVisible();
  },
};

// A phone reads each product as a block — name, code and owner, the units at the end — not a squeezed table.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByRole("table")).toBeNull();
    const beras = within(canvas.getByTestId("stock-row-SKU-BERAS-5K"));
    await expect(beras.getByText("Beras Pandan Wangi 5kg")).toBeVisible();
    await expect(beras.getByTestId("stock-owner-SKU-BERAS-5K")).toHaveTextContent("Toko Melati");
    await expect(beras.getByTestId("stock-onhand-SKU-BERAS-5K")).toHaveTextContent("8");
  },
};

// A product emptied to 0 stays on the list — so it can still be found and adjusted.
export const HeldAtZeroIsListedAndAdjusted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("stock-onhand-SL-03-ANG-002")).toHaveTextContent("0");
    await expect(canvas.getByTestId("stock-onhand-SL-03-ANG-004")).toHaveTextContent("0");

    await userEvent.click(canvas.getByTestId("row-actions-SL-03-ANG-002"));
    const adjust = await screen.findByTestId("adjust-SL-03-ANG-002");
    await waitFor(() => expect(adjust).toBeVisible());
    await userEvent.click(adjust);

    const dialog = await screen.findByTestId("adjust-dialog");
    await expect(dialog).toHaveTextContent("Minyak Goreng Sawit 2L — Karton");
  },
};

// An archived product held here is listed, labelled — its seller retired it from the catalogue, not from the shelf.
export const ArchivedIsLabelled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("stock-archived-SL-03-ANG-001-L")).toHaveTextContent("Archived");
    await expect(canvas.getByTestId("stock-row-SL-03-ANG-001-L")).toHaveTextContent("Minyak Goreng Sawit 2L — Kemasan Lama");
    await expect(canvas.queryByTestId("stock-archived-SL-03-ANG-001")).toBeNull();
    await expect(canvas.queryByTestId("stock-archived-SKU-BERAS-5K")).toBeNull();
  },
};

// The search runs on the server, by name or by code, and is kept in the URL. One letter does not narrow — the server
// searches from the second.
export const SearchNarrows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await search(canvas, "tepung");
    await waitFor(() => expect(listed(canvas)).toEqual(["SL-03-ANG-004", "SL-03-ANG-003"]));
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("q=tepung");

    await search(canvas, "ang-001");
    await waitFor(() => expect(listed(canvas)).toEqual(["SL-03-ANG-001-L", "SL-03-ANG-001"]));

    await search(canvas, "t");
    await waitFor(() => expect(listed(canvas)).toEqual(GUDANG_PUSAT));
    await expect(canvas.queryByTestId("inventory-error")).toBeNull();
  },
};

// A product never held here is not found, however well it matches — and the hint clears the search.
export const NothingMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await search(canvas, "kopi");
    const none = await canvas.findByTestId("inventory-none-match");
    await expect(none).toHaveTextContent("No product here matches the search.");

    await userEvent.click(within(none).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(listed(canvas)).toEqual(GUDANG_PUSAT));
  },
};

// A warehouse nothing has ever been stocked in says so — not that it has no catalogue.
export const NothingStockedYet: Story = {
  beforeEach: warehouseStockNothingHeld,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const empty = await canvas.findByTestId("inventory-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("Nothing is stocked here yet.");
    await expect(empty).not.toHaveTextContent("catalogue");
  },
};

// The admin team's monitor opens another warehouse from the URL and reads its stock — and is offered no Adjust or Move.
export const AMonitorReadsAnotherWarehouse: Story = {
  beforeEach: asAdminTeam(),
  render: () => <RoutedCabang />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(listed(canvas)).toEqual(["SKU-BERAS-5K", "SKU-GULA-1K", "SL-03-ANG-001", "SL-03-ANG-003"]);
    await expect(canvas.getByTestId("stock-onhand-SL-03-ANG-001")).toHaveTextContent("10");
    await expect(canvas.getByTestId("stock-onhand-SL-03-ANG-003")).toHaveTextContent("4");
    await expect(canvas.queryByTestId("row-actions-SKU-BERAS-5K")).toBeNull();
  },
};

// Here a row opens nothing: the warehouse product page reads the CURRENT team's building, so it is a warehouse's own —
// reached from its Products.
export const ARowOpensNothingHere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByText("Beras Pandan Wangi 5kg"));
    await expect(canvas.queryByTestId("at-warehouse-product")).toBeNull();
    await expect(canvas.getByTestId("inventory-page")).toBeInTheDocument();
  },
};

// Root and the admin team pick the warehouse; with none picked the page asks for one.
export const RootPicksAWarehouse: Story = {
  beforeEach: () => {
    asTeam(ROOT_TEAM_ID)();
    asPlatformOnly(Role.ROOT)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("inventory-pick-warehouse", {}, { timeout: 4000 })).toHaveTextContent(
      "Pick a warehouse to see its stock.",
    );
    await expect(canvas.queryByTestId("inventory-table")).toBeNull();
  },
};
