import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIER_DETAIL_META, AtBanyak, AtSinar, SHOPEE_STORE, loaded, openProducts } from "./kit";

// SUPPLIER DETAIL — the Products tab — sample rows naming their store, the search, the pager, and Sold and Ready
// (the-detail-tabs-show-sold-and-ready). The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierDetail/Products",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// products-hang-off-a-channel: each product names the channel it is bought from. SAMPLE rows, made up from
// the supplier's real channels — two per channel.
export const ProductsNameTheirChannel: Story = {
  name: "Name their store",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    await openProducts(canvas);

    const table = await canvas.findByTestId("products-table");
    await expect(within(table).getAllByRole("row")).toHaveLength(1 + 2 * 3);
    await expect(canvas.getByTestId(`product-row-${SHOPEE_STORE.id}-0`)).toHaveTextContent(SHOPEE_STORE.name);
    await expect(canvas.getByTestId(`product-row-${SHOPEE_STORE.id}-0`)).toHaveTextContent("Shopee");
  },
};

export const NoChannelsMeansNoProducts: Story = {
  name: "No stores, no products",
  render: () => <AtSinar />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await canvas.findByTestId("channels-empty");
    await openProducts(canvas);
    await canvas.findByTestId("products-empty");
  },
};

// the-products-tab-searches-and-pages: the product, its SKU, or the channel it is bought from.
export const ProductsSearch: Story = {
  name: "Search",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);
    await openProducts(canvas);

    await userEvent.type(canvas.getByTestId("products-search"), "KTN", { delay: 40 });
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 1));
    await expect(canvas.getByTestId("products-table")).toHaveTextContent("Kain Katun Jepang");

    await userEvent.clear(canvas.getByTestId("products-search"));
    await userEvent.type(canvas.getByTestId("products-search"), "zzz", { delay: 40 });
    await canvas.findByTestId("products-none-match");
  },
};

// Twelve channels make twenty-four sample products: three pages of ten.
export const ProductsPaginate: Story = {
  name: "Pages",
  render: () => <AtBanyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId("channel-row-362");
    await openProducts(canvas);

    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 10));
    await userEvent.click(canvas.getByTestId("products-pager-next"));
    await userEvent.click(canvas.getByTestId("products-pager-next"));
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 4));

    // every-list-pages-with-the-growing-pager: page 1 is one click back, not two.
    await userEvent.click(canvas.getByTestId("products-pager-page-1"));
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 10));
  },
};

// A PRODUCT SHOWS ITS SOLD AND READY — the last two columns, the last order under Terjual; no restock date under Siap,
// since Last bought, just left of it, is that date.
export const AProductShowsItsSoldAndReady: Story = {
  name: "Sold and Ready",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);
    await openProducts(canvas);

    const table = await canvas.findByTestId("products-table");
    const headers = within(table).getAllByRole("columnheader");
    await expect(headers.at(-2)).toHaveTextContent(/^Sold/);
    await expect(headers.at(-1)).toHaveTextContent(/^Ready/);
    const key = `${SHOPEE_STORE.id}-0`;
    await expect(canvas.getByTestId(`product-sold-${key}`)).toHaveTextContent(/^[\d.]+ordered /);
    await expect(canvas.getByTestId(`product-ready-${key}`)).toHaveTextContent(/^[\d.]+$/);
  },
};

// …and on a phone, a line each in the store's block and in the product's — the product's Siap without a date.
export const APhoneStoreAndProductCarryTheirFigures: Story = {
  name: "Phone · Sold and Ready",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const store = await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}-figures`);
    await expect(store).toHaveTextContent(/Sold [\d.]+ · ordered .+Ready [\d.]+ · restocked /);
    await expect(within(store).getByTestId("not-implemented-sold")).toHaveTextContent("2");

    await openProducts(canvas);
    const product = await canvas.findByTestId(`product-row-${SHOPEE_STORE.id}-0-figures`);
    await expect(product).toHaveTextContent(/Sold [\d.]+ · ordered .+Ready [\d.]+$/);
  },
};
