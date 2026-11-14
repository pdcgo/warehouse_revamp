import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { supplierExportScenario } from "../../../../.storybook/supplierExportScenario";
import { SUMBER, SUPPLIER_DETAIL_META, AtBanyak, AtSinar, SHOPEE_STORE, loaded, openProducts } from "./kit";

// SUPPLIER DETAIL — the Products tab on REAL rows (SupplierChannelService.SupplierProductList, played by the stub over
// supplierProductFixtures.ts): each product naming its store — or "—" for none — the search, the pager, its Sold and
// Ready (the-detail-tabs-show-sold-and-ready) and its Export. The page's stories are grouped by the part of the screen
// they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierDetail/Products",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = (canvas: ReturnType<typeof within>) => within(canvas.getByTestId("products-table")).getAllByRole("row");

// products-hang-off-a-channel: each product names the store it was bought at, with its type; a product bought with no
// store reads "—" (a-line-with-no-store-links-under-the-supplier).
export const ProductsNameTheirChannel: Story = {
  name: "Name their store",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    await openProducts(canvas);

    await canvas.findByTestId("products-table", {}, { timeout: 4000 });
    await expect(rows(canvas)).toHaveLength(1 + 5);
    await expect(canvas.getByTestId("product-row-3101-store")).toHaveTextContent(SHOPEE_STORE.name);
    await expect(canvas.getByTestId("product-row-3101-store")).toHaveTextContent("Shopee");
    await expect(canvas.getByTestId("product-row-3104-store")).toHaveTextContent(/^—$/);
  },
};

// Nothing bought from it — the hint says when products come.
export const NoChannelsMeansNoProducts: Story = {
  name: "Nothing bought, no products",
  render: () => <AtSinar />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await canvas.findByTestId("channels-empty");
    await openProducts(canvas);
    await canvas.findByTestId("products-empty", {}, { timeout: 4000 });
  },
};

// the-products-tab-searches-and-pages: the product, its SKU, or the store it was bought at — on the server.
export const ProductsSearch: Story = {
  name: "Search",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);
    await openProducts(canvas);
    await canvas.findByTestId("products-table", {}, { timeout: 4000 });

    await userEvent.type(canvas.getByTestId("products-search"), "KTN", { delay: 40 });
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));
    await expect(canvas.getByTestId("products-table")).toHaveTextContent("Kain Katun Jepang");

    await userEvent.clear(canvas.getByTestId("products-search"));
    await userEvent.type(canvas.getByTestId("products-search"), "zzz", { delay: 40 });
    await canvas.findByTestId("products-none-match");
  },
};

// Twenty-four products: three pages of ten.
export const ProductsPaginate: Story = {
  name: "Pages",
  render: () => <AtBanyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId("channel-row-362");
    await openProducts(canvas);
    await canvas.findByTestId("products-table", {}, { timeout: 4000 });

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 10));
    await userEvent.click(canvas.getByTestId("products-pager-next"));
    await userEvent.click(canvas.getByTestId("products-pager-next"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 4));

    // every-list-pages-with-the-growing-pager: page 1 is one click back, not two.
    await userEvent.click(canvas.getByTestId("products-pager-page-1"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 10));
  },
};

// A PRODUCT SHOWS ITS SOLD AND READY — the last two columns, the last order under Terjual; no restock date under Siap,
// since Last bought, just left of it, is that date. Real, so unmarked.
export const AProductShowsItsSoldAndReady: Story = {
  name: "Sold and Ready",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);
    await openProducts(canvas);

    const table = await canvas.findByTestId("products-table", {}, { timeout: 4000 });
    const headers = within(table).getAllByRole("columnheader");
    await expect(headers.at(-2)).toHaveTextContent(/^Sold$/);
    await expect(headers.at(-1)).toHaveTextContent(/^Ready$/);
    await expect(canvas.getByTestId("product-sold-3101")).toHaveTextContent(/^412ordered /);
    await expect(canvas.getByTestId("product-ready-3101")).toHaveTextContent(/^37$/);
    await expect(within(table).queryByTestId("not-implemented-sold")).toBeNull();
  },
};

// …and on a phone, a line each in the store's block and in the product's — the product's Siap without a date.
export const APhoneStoreAndProductCarryTheirFigures: Story = {
  name: "Phone · Sold and Ready",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const store = await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}-figures`);
    await waitFor(() => expect(store).toHaveTextContent(/Sold 1\.204 · ordered .+Ready 86 · restocked /));
    await expect(within(store).queryByTestId("not-implemented-sold")).toBeNull();

    await openProducts(canvas);
    const product = await canvas.findByTestId("product-row-3101-figures", {}, { timeout: 4000 });
    await expect(product).toHaveTextContent(/^Sold 412 · ordered .+Ready 37$/);
  },
};

// THE TAB AS A FILE (each-supplier-tab-exports-its-own-table): every product the tab holds, for this supplier.
export const ExportsTheProductsTab: Story = {
  name: "Export",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openProducts(canvas);
    await canvas.findByTestId("products-table", {}, { timeout: 4000 });

    await userEvent.click(canvas.getByTestId("products-export"));
    await waitFor(() => expect(supplierExportScenario.products).toHaveLength(1));
    await expect(supplierExportScenario.products[0]).toMatchObject({ teamId: 12n, supplierId: SUMBER.id, rows: 5 });
  },
};
