import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { Box, Text } from "@chakra-ui/react";
import { useLocation, useParams } from "react-router-dom";
import { expect, userEvent, within } from "storybook/test";

import { routedPage } from "../../../.storybook/pageStory";
import { BatchOrigin, StockBatchSchema } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { cameFrom } from "../../lib/cameFrom";
import { BatchSource, description } from "./BatchSource";

// WHERE A BATCH CAME FROM, AS A WAY THERE (a-batch-opens-where-it-came-from, a-returns-batch-opens-its-order) — inside a
// row that opens the batch.

let rowClicks = 0;

const RESTOCK = create(StockBatchSchema, { id: 5031n, deliveryId: 503n, receiptNo: "SCP5544332211", origin: BatchOrigin.RESTOCK });
// A return's batch names the order whose return it is — Pak Firman's 106.
const RETURN = create(StockBatchSchema, { id: 9101n, deliveryId: 0n, origin: BatchOrigin.RETURN, returnOrderId: 106n });
// A return no order names yet: its stock went in, the order's move to return_completed has not landed.
const UNNAMED = create(StockBatchSchema, { id: 9102n, deliveryId: 0n, origin: BatchOrigin.RETURN, returnOrderId: 0n });

/** The order's warehouse page, saying which order and where it was opened from (its Back). */
function AtWarehouseOrder() {
  const { orderId } = useParams();
  const from = cameFrom(useLocation());

  return (
    <Text data-testid="at-warehouse-order" data-order-id={orderId} data-from={from ?? ""}>
      at-warehouse-order
    </Text>
  );
}

const InARow = routedPage(
  [
    {
      path: "/",
      element: (
        <Box p="2" onClick={() => (rowClicks += 1)}>
          <BatchSource batch={RESTOCK} testId="source-restock" />
          {" · "}
          <BatchSource batch={RETURN} testId="source-return" />
          {" · "}
          <BatchSource batch={UNNAMED} testId="source-unnamed" />
        </Box>
      ),
    },
    { path: "/inventories/restock/:requestId", element: <Text data-testid="at-restock">at-restock</Text> },
    { path: "/warehouse-orders/:orderId", element: <AtWarehouseOrder /> },
  ],
  "/",
);

const meta = {
  title: "Features/Inventory/BatchSource",
  component: InARow,
  parameters: { dataRouter: true, docs: { description: { component: description } } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// A restock's batch opens its restock — no resi — and the click never reaches the row.
export const OpensTheRestock: Story = {
  name: "Opens the restock",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    rowClicks = 0;

    await expect(canvas.getByTestId("source-restock")).toHaveTextContent(/^Restock #503$/);

    await userEvent.click(canvas.getByTestId("source-restock"));
    await canvas.findByTestId("at-restock");
    await expect(rowClicks).toBe(0);
  },
};

// A RETURN'S BATCH OPENS ITS ORDER (a-returns-batch-opens-its-order): *Return · order #106*, a link to that order's
// WAREHOUSE page — /warehouse-orders/106, where the return was accepted — carrying where it was opened, so Back returns;
// the click never reaches the row, and nothing is marked unbuilt any more.
export const OpensTheReturnsOrder: Story = {
  name: "Opens the return's order",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    rowClicks = 0;

    const source = canvas.getByTestId("source-return");
    await expect(source).toHaveTextContent(/^Return · order #106$/);
    await expect(source.tagName).toBe("A");
    await expect(source).toHaveAttribute("data-order-id", "106");
    await expect(canvas.queryByTestId("not-implemented-returnLink")).toBeNull();

    await userEvent.click(source);
    const at = await canvas.findByTestId("at-warehouse-order");
    await expect(at).toHaveAttribute("data-order-id", "106");
    await expect(at).toHaveAttribute("data-from", "/");
    await expect(rowClicks).toBe(0);
  },
};

// A return no order names yet reads *Return*, plain — nothing to open, nothing marked.
export const AReturnWithNoOrderYet: Story = {
  name: "A return with no order yet",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const source = canvas.getByTestId("source-unnamed");
    await expect(source).toHaveTextContent(/^Return$/);
    await expect(source.tagName).not.toBe("A");
    await expect(source).not.toHaveAttribute("data-order-id");
    await expect(within(source).queryByRole("link")).toBeNull();
  },
};
