import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { GUDANG_CABANG, GUDANG_PUSAT, productReprintScenario, reprintNothingWaitsForStory } from "../../../../.storybook/productReprintStub";
import { asAdminTeam, asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ProductReprintLabelsPage, REPRINT_LABELS_PATH } from "../../product-reprint-labels";
import { ProductsPage } from "../index";

// PRODUCTS — A WAREHOUSE'S REPRINT ENTRY (backlog #151, live since the-team-code-and-product-tags-prototype-is-accepted,
// row *the reprint*). While a product whose code changed still waits for THIS warehouse's labels, *Cetak ulang kode (N)*
// sits in the held list's header and opens the reprint (products-have-their-own-tag-list, 🔄 what clears: "a NEW print, of
// the tagged products' placements, opened from the warehouse's Products list"). N rides on the list's own read
// (WarehouseStockList `reprint_waiting`, .storybook/productReprintStub.ts): Gudang Pusat (11) waits for Minyak and Tepung
// Karton (2); Gudang Cabang (14) for Minyak (1). The list's tags themselves: ./WarehouseTags.stories.tsx.

const routes = [
  { path: "/products", element: <><ProductsPage /><LocationProbe hidden /></> },
  { path: REPRINT_LABELS_PATH, element: <ProductReprintLabelsPage /> },
  marker("/inventories/products/:productId", "at-warehouse-product"),
];
const AtProducts = routedPage(routes, "/products");

const meta = {
  title: "Pages/Products/Products/WarehouseReprint",
  component: AtProducts,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(GUDANG_PUSAT)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function heldLoaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("stock-row-SKU-BERAS-5K", {}, { timeout: 5000 });
  return canvas;
}

/** The entry says how many products wait for THIS warehouse's labels — 2 at Gudang Pusat — on the list's own read: the
 *  reprint itself is not read until the entry opens it. */
export const TheReprintEntry: Story = {
  name: "Reprint entry",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("open-reprint-labels")).toHaveTextContent("Reprint codes (2)"), { timeout: 5000 });
    await expect(productReprintScenario.listReads).toBe(0);
  },
};

/** Each warehouse counts its own — Gudang Cabang waits only for Minyak. */
export const EachWarehouseCountsItsOwn: Story = {
  name: "Reprint entry, another warehouse",
  beforeEach: () => {
    asTeam(GUDANG_CABANG)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("open-reprint-labels", {}, { timeout: 5000 })).toHaveTextContent("Reprint codes (1)");
  },
};

/** The entry opens the reprint page. */
export const TheEntryOpensTheReprint: Story = {
  name: "Entry opens the reprint",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);
    await userEvent.click(await canvas.findByTestId("open-reprint-labels", {}, { timeout: 5000 }));

    await waitFor(() => expect(canvas.getByTestId("reprint-page")).toBeVisible(), { timeout: 5000 });
    await expect(await canvas.findByTestId("reprint-count", {}, { timeout: 5000 })).toHaveTextContent("3 to print · 2 products");
  },
};

/** A monitor reads the list and its tags — and gets no reprint: printing is the warehouse's own people's. */
export const AMonitorGetsNoReprint: Story = {
  name: "Monitor: no reprint",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await expect(canvas.getByTestId("stock-tags-SL-03-ANG-001")).toBeVisible();
    await expect(canvas.queryByTestId("open-reprint-labels")).toBeNull();
  },
};

/** On a phone: the entry is the header's icon. */
export const OnAPhone: Story = {
  name: "Reprint entry, phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("open-reprint-labels")).toBeVisible(), { timeout: 5000 });
    const block = canvas.getByTestId("stock-row-SL-03-ANG-001");
    await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth);
  },
};

/** NOTHING WAITS HERE — the held list as it was before any code changed: the live tags, and no reprint entry (hidden at
 *  0). */
export const NoEntryWhileNothingWaits: Story = {
  name: "No entry while nothing waits",
  beforeEach: () => reprintNothingWaitsForStory(),
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);
    const headers = [...canvas.getByTestId("inventory-table").querySelectorAll("thead th")].map((th) => th.textContent);

    await expect(headers).toEqual(["Product code", "Product", "Tags", "Owner", "On hand", "Actions"]);
    await expect(canvas.queryByTestId("open-reprint-labels")).toBeNull();
  },
};
