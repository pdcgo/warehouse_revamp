import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { PRODUCT_TAG, productTagScenario } from "../../../../.storybook/productTagScenario";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { WarehouseProductPage } from "../index";

// THE WAREHOUSE PRODUCT PAGE — THE PRODUCT'S TAGS, READ-ONLY (backlog #148, live: the-team-code-and-product-tags-
// prototype-is-accepted). A warehouse holding the product's stock sees its tags (products-have-their-own-tag-list, 🔄 who
// sees) — under the code, as chips, all of them; it changes none (only the owning team's writers do — a warehouse writes
// no product, only-a-selling-team-owns-a-catalogue). The page reads the product by id (ProductByIds, which carries no
// tags), so the chips come from ONE ProductTagsByIds beside the page's other reads (productTagStub.ts: the team's own
// products and the ones it holds; anything else absent). Gudang Pusat (11) holds Minyak (700).

const GUDANG_PUSAT = 11n;

const Routed = (id: number) =>
  routedPage(
    [{ path: "/inventories/products/:productId", element: <WarehouseProductPage /> }, marker("/products", "at-products")],
    `/inventories/products/${id}`,
  );
const AtMinyak = Routed(700);
const AtGula = Routed(73);

const meta = {
  title: "Pages/Inventory/Products/WarehouseProduct/Tags",
  component: AtMinyak,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(GUDANG_PUSAT)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("warehouse-product-page", {}, { timeout: 5000 });
  return canvas;
}

/** Under the code, every tag as a chip — need_reprint_code first, locked — and nothing to change them with. One read
 *  for them: ProductTagsByIds, asked for this product alone. */
export const TheTagsReadOnly: Story = {
  name: "Tags, read-only",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const tags = within(await canvas.findByTestId("wp-tags", {}, { timeout: 5000 }));

    await expect(canvas.getByTestId("warehouse-product-page")).toHaveTextContent("SL-03-ANG-001");

    await expect(tags.getAllByTestId(/^wp-tags-\d+$/).map((el) => el.textContent)).toEqual(["need_reprint_code", "Laris", "Promo Lebaran"]);
    await expect(tags.getByTestId(`wp-tags-${PRODUCT_TAG.reprint}-lock`)).toBeInTheDocument();
    await expect(tags.queryByTestId(`wp-tags-${PRODUCT_TAG.laris}-remove`)).toBeNull();
    await expect(tags.queryByTestId("wp-tags-more")).toBeNull();
    await expect(productTagScenario.byIdsCalls).toEqual([[700n]]);
  },
};

/** A product with no tags draws no line. */
export const NoTagsNoLine: Story = {
  name: "No tags, no line",
  render: () => <AtGula />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(productTagScenario.byIdsCalls).toEqual([[73n]]));
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(canvas.queryByTestId("wp-tags")).toBeNull();
  },
};

/** On a phone the chips wrap under the code. */
export const OnAPhone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const tags = await canvas.findByTestId("wp-tags", {}, { timeout: 5000 });

    await expect(tags.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  },
};
