import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { PRODUCT_TAG, productTagScenario } from "../../../../.storybook/productTagScenario";
import { asAdminTeam, asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ProductsPage } from "../index";

// PRODUCTS — A WAREHOUSE'S HELD LIST AND ITS TAGS (backlog #148, live: the-team-code-and-product-tags-prototype-is-
// accepted). A warehouse holding a product's stock sees its tags (products-have-their-own-tag-list, 🔄 who sees): a Tag
// column after the product, a line of chips per phone block, the Tag filter (any of several, in the address, sent to the
// server as `tag_ids`). The chips ride on WarehouseStockList's rows (WarehouseProductSearchItem.tags) — never a read per
// row. Gudang Pusat (11) holds Minyak (700) and Tepung Karton (703), both on need_reprint_code, and Toko Melati's Beras
// (74) on Laris. The reprint entry beside them is #151's prototype: ./WarehouseReprint.stories.tsx.

const GUDANG_PUSAT = 11n;

const routes = [
  { path: "/products", element: <><ProductsPage /><LocationProbe hidden /></> },
  marker("/inventories/products/:productId", "at-warehouse-product"),
];
const AtProducts = routedPage(routes, "/products");

const meta = {
  title: "Pages/Products/Products/WarehouseTags",
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

const held = (canvas: ReturnType<typeof within>) =>
  canvas.getAllByTestId(/^stock-row-/).map((el: HTMLElement) => el.dataset.testid!.replace("stock-row-", ""));

/** The warehouse sees every held product's tags — another team's too (Toko Melati's Beras carries Laris) — in a Tag
 *  column after the product. */
export const AWarehouseSeesTheTags: Story = {
  name: "Tag column",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);
    const headers = [...canvas.getByTestId("inventory-table").querySelectorAll("thead th")].map((th) => th.textContent);

    await expect(headers).toEqual(["Product code", "Product", "Tags", "Owner", "On hand", "Actions"]);
    await expect(canvas.getByTestId(`stock-tags-SL-03-ANG-001-${PRODUCT_TAG.reprint}`)).toHaveTextContent("need_reprint_code");
    await expect(canvas.getByTestId("stock-tags-SL-03-ANG-001-more")).toHaveTextContent("+1");
    await expect(canvas.getByTestId("stock-tags-SKU-BERAS-5K")).toHaveTextContent("Laris");
    await expect(canvas.getByTestId("stock-tags-cell-SKU-GULA-1K")).toBeEmptyDOMElement();
    // The chips are the rows' own — the list is asked with no tag, and the tag list is read once, for the filter.
    await expect(productTagScenario.listTagIds.at(-1)).toEqual([]);
    await waitFor(() => expect(productTagScenario.catalogueReads).toBe(1));
  },
};

/** The Tag filter on the warehouse's list — need_reprint_code is the two still waiting; the server is asked for it;
 *  Hapus Filter brings the whole list back. */
export const TheTagFilter: Story = {
  name: "Tag filter",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-tag-filter-input"));
    await waitFor(() => expect(canvas.getByTestId(`product-tag-filter-option-${PRODUCT_TAG.reprint}`)).toBeVisible());
    await userEvent.click(canvas.getByTestId(`product-tag-filter-option-${PRODUCT_TAG.reprint}`));

    await waitFor(() => expect(held(canvas)).toEqual(["SL-03-ANG-001", "SL-03-ANG-004"]));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`tag=${PRODUCT_TAG.reprint}`));
    await expect(productTagScenario.listTagIds.at(-1)).toEqual([PRODUCT_TAG.reprint]);

    await userEvent.click(canvas.getByTestId("inventory-filter-clear"));
    await waitFor(() => expect(held(canvas).length).toBe(7));
    await expect(productTagScenario.listTagIds.at(-1)).toEqual([]);
  },
};

/** A monitor reads the list and its tags. */
export const AMonitorSeesTheTags: Story = {
  name: "Monitor sees the tags",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await expect(canvas.getByTestId("stock-tags-SL-03-ANG-001")).toBeVisible();
    await expect(canvas.getByTestId("inventory-tag-filter")).toBeVisible();
  },
};

/** On a phone each block carries its chips, and nothing runs past its edge. */
export const OnAPhone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    const block = canvas.getByTestId("stock-row-SL-03-ANG-001");
    await expect(within(block).getByTestId("stock-tags-SL-03-ANG-001")).toHaveTextContent("need_reprint_code");
    await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth);
  },
};
