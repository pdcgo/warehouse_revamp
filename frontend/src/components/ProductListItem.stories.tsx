import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { products } from "../../.storybook/fixtures";
import { ProductListItem, description } from "./ProductListItem";

const product = products[0]!;

const meta = {
  title: "Components/ProductListItem",
  component: ProductListItem,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    product: { id: product.id, teamId: product.teamId, sku: product.sku, name: product.name },
  },
} satisfies Meta<typeof ProductListItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithStock: Story = { args: { stock: 42n } };

export const WithTeamName: Story = { args: { teamName: "Gudang Pusat", stock: 42n } };

export const Large: Story = { args: { size: "lg", stock: 42n } };

export const WithAction: Story = {
  args: { stock: 42n, action: <Button size="xs">Pick</Button> },
};

export const InAList: Story = {
  render: () => (
    <Stack gap="3" w="lg">
      {products.map((p) => (
        <ProductListItem key={p.id.toString()} product={p} stock={BigInt(p.reservedStock)} />
      ))}
    </Stack>
  ),
};

// ⚠ THE BUG THIS PINS: `stock` is optional AND `0n` is falsy, so the "show it?" test has to be
// `!== undefined`. A plain `if (stock)` hides the out-of-stock case — which is the single most
// important number on the row. Nothing about the rendered output makes that mistake visible, so it
// gets a test rather than a comment.
export const ZeroStockStillShows: Story = {
  args: { stock: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const badge = canvas.getByTestId(`product-list-item-stock-${product.id}`);
    await expect(badge).toBeInTheDocument();
    await expect(badge).toHaveTextContent(/out of stock/i);
  },
};

// Omitting `stock` is the "optional show" case and means the caller has no stock figure — which is
// NOT the same as zero, and must render no badge at all rather than a confident "out of stock".
export const NoStockFigureShowsNoBadge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId(`product-list-item-stock-${product.id}`)).toBeNull();
  },
};

// `ongoing` follows the OPPOSITE rule to `stock`: nothing on the way is the normal state of most
// products, so a badge saying so on every row would be noise. Shown only when > 0.
export const OngoingOnlyWhenThereIsSome: Story = {
  args: { stock: 3n, ongoing: 12n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`product-list-item-ongoing-${product.id}`)).toHaveTextContent("12");
  },
};

export const OngoingZeroIsHidden: Story = {
  args: { stock: 3n, ongoing: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId(`product-list-item-ongoing-${product.id}`)).toBeNull();
  },
};

// A product with no name falls back to its SKU — and then must NOT repeat that SKU on the line
// underneath, which would read as two different identifiers.
export const NamelessProductDoesNotRepeatItsSku: Story = {
  args: { product: { id: 77n, sku: "SKU-ONLY" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByText("SKU-ONLY")).toHaveLength(1);
  },
};
