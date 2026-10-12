import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { SupplierChannelRecord } from "./adapt";
import { ProductBrowser } from "./ProductBrowser";

// A supplier's Products tab, shared by the manage and discover details. ⚠ SAMPLE rows — two invented products
// per channel (sampleProducts.ts) until the channel-product linking is designed (linking-products-is-deferred).

const channel = (id: number, channelType: Marketplace, name: string): SupplierChannelRecord => ({
  id: BigInt(id),
  supplierId: 1n,
  channelType,
  name,
  uri: "",
  description: "",
});

const TWO = [channel(1, Marketplace.SHOPEE, "Sumber Makmur Official"), channel(2, Marketplace.TOKOPEDIA, "Sumber Makmur Store")];
const SEVEN = Array.from({ length: 7 }, (_, i) => channel(10 + i, Marketplace.LAZADA, `Store ${i + 1}`));

const meta = {
  title: "Features/Suppliers/ProductBrowser",
  component: ProductBrowser,
  args: { channels: TWO },
} satisfies Meta<typeof ProductBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoChannels: Story = { args: { channels: [] } };

// Each product names the channel it is bought from (products-hang-off-a-channel).
export const ProductsNameTheirChannel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 4);
    await expect(canvas.getByTestId("product-row-1-0")).toHaveTextContent("Sumber Makmur Official");
  },
};

export const SearchesProductSkuOrChannel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("products-search"), "Sumber Makmur Store", { delay: 20 });
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 2));
  },
};

// Seven channels, fourteen products: two pages of ten.
export const Paginates: Story = {
  args: { channels: SEVEN },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 10));
    await userEvent.click(canvas.getByTestId("page-next"));
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 4));
  },
};
