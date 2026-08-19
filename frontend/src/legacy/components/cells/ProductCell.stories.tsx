import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, waitFor, within } from "storybook/test";

import { ProductCell, description } from "./ProductCell";

const meta = {
  title: "Legacy/Components/Cells/ProductCell",
  component: ProductCell,
  parameters: { docs: { description: { component: description } } },
  args: {
    product: { id: 8842n, name: "Kaos Polos Cotton Combed 30s Hitam L", refId: "SKU-8842-BLK-L" },
  },
} satisfies Meta<typeof ProductCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("Kaos Polos");
    await expect(canvas.getByTestId("refid-badge")).toHaveTextContent("SKU-8842-BLK-L");
  },
};

// RULE 2: an unresolved product still occupies a row, and a blank cell reads as a rendering bug.
// "#8842" is at least something the reader can search for or quote.
export const UnresolvedFallsBackToTheId: Story = {
  args: { product: undefined, productId: 8842n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("#8842");
  },
};

// RULE 3: a skeleton ONLY when there is nothing cached. A refetch over a resolved product keeps the
// name on screen — otherwise a table would strobe on every background refresh.
export const LoadingWithNothingCached: Story = {
  args: { product: undefined, loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell")).toHaveAttribute("data-loading", "true");
  },
};

export const RefetchingKeepsTheName: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell")).not.toHaveAttribute("data-loading");
    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("Kaos Polos");
  },
};

// RULE 1: the name clips rather than wraps, so one long product name cannot make its row taller
// than every other row in the column.
export const LongNameClips: Story = {
  render: (args) => (
    <Box w="220px" borderWidth="1px" p="2">
      <ProductCell {...args} />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The name IS a ClippedText — EntityCell overrides its test id, so the proof that clipping is
    // wired up is the measurement attribute the component sets on itself.
    await waitFor(async () => {
      await expect(canvas.getByTestId("entity-cell-name")).toHaveAttribute("data-clipped", "true");
    });
  },
};

export const NoRefId: Story = {
  args: { product: { id: 8842n, name: "Hoodie Abu XL" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("refid-badge")).toBeNull();
  },
};
