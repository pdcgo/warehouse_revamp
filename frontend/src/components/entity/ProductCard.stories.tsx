import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, SimpleGrid } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { products } from "../../../.storybook/fixtures";
import { ProductCard, description } from "./ProductCard";

const product = products[0]!;

const meta = {
  title: "Components/Entity/ProductCard",
  component: ProductCard,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    product: { id: product.id, teamId: product.teamId, sku: product.sku, name: product.name },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 220 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProductCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithStock: Story = { args: { stock: 42n } };

export const OutOfStock: Story = { args: { stock: 0n } };

export const WithAction: Story = {
  args: { stock: 42n, action: <Button size="xs" w="full">Add</Button> },
};

// The card's reason to exist: a GRID. `h="full"` makes cards in a row share a height however long
// their names run, so the covers line up — which is what makes a grid scannable at all. A card
// reviewed alone cannot show that.
export const InAGrid: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 700 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <SimpleGrid columns={3} gap="4">
      {products.map((p) => (
        <ProductCard key={p.id.toString()} product={p} stock={BigInt(p.reservedStock)} />
      ))}
      <ProductCard
        product={{ id: 99n, sku: "SKU-PANJANG", name: "Nama produk yang sangat panjang sekali untuk menguji tinggi kartu" }}
        stock={7n}
      />
    </SimpleGrid>
  ),
};

// Same trap as ProductListItem, and worth its own test because this is a SEPARATE implementation of
// the rule: 0n is falsy, so the check must be `!== undefined` or the out-of-stock case disappears.
export const ZeroStockStillShows: Story = {
  args: { stock: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`product-card-stock-${product.id}`)).toHaveTextContent(/out of stock/i);
  },
};

export const NoStockFigureShowsNoBadge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId(`product-card-stock-${product.id}`)).toBeNull();
  },
};

// The card and the list item take the SAME props on purpose — a screen swaps a list for a grid by
// swapping the component, not by reshaping its data. This renders one product through the card to
// show the shared vocabulary holds (the strings come from the same `productListItem.*` keys).
export const SharesProductListItemsVocabulary: Story = {
  args: { stock: 5n, teamName: "Gudang Pusat" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText(product.name)).toBeInTheDocument();
    await expect(canvas.getByText(product.sku)).toBeInTheDocument();
    await expect(canvas.getByText("Gudang Pusat")).toBeInTheDocument();
  },
};
