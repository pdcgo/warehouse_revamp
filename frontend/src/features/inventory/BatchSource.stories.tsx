import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { Box, Text } from "@chakra-ui/react";
import { expect, userEvent, within } from "storybook/test";

import { routedPage } from "../../../.storybook/pageStory";
import { BatchOrigin, StockBatchSchema } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { BatchSource, description } from "./BatchSource";

// WHERE A BATCH CAME FROM, AS A WAY THERE (a-batch-opens-where-it-came-from) — inside a row that opens the batch.

let rowClicks = 0;

const RESTOCK = create(StockBatchSchema, { id: 5031n, deliveryId: 503n, receiptNo: "SCP5544332211", origin: BatchOrigin.RESTOCK });
const RETURN = create(StockBatchSchema, { id: 9101n, deliveryId: 0n, origin: BatchOrigin.RETURN });

const InARow = routedPage(
  [
    {
      path: "/",
      element: (
        <Box p="2" onClick={() => (rowClicks += 1)}>
          <BatchSource batch={RESTOCK} testId="source-restock" />
          {" · "}
          <BatchSource batch={RETURN} testId="source-return" />
        </Box>
      ),
    },
    { path: "/inventories/restock/:requestId", element: <Text data-testid="at-restock">at-restock</Text> },
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

// A restock's batch opens its restock — no resi — and the click never reaches the row; a return's carries its ⚠.
export const OpensTheRestock: Story = {
  name: "Opens the restock",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    rowClicks = 0;

    await expect(canvas.getByTestId("source-restock")).toHaveTextContent(/^Restock #503$/);
    await expect(within(canvas.getByTestId("source-return")).getByTestId("not-implemented-returnLink")).toBeVisible();

    await userEvent.click(canvas.getByTestId("source-restock"));
    await canvas.findByTestId("at-restock");
    await expect(rowClicks).toBe(0);
  },
};
