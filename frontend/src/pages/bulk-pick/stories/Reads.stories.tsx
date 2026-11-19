import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { bulkPickScenario } from "../../../../.storybook/bulkPickScenario";
import { pickTransactionOf } from "../../../../.storybook/fixtures";
import { BulkPickPage } from "../index";
import { DESKTOP, SCENE, SCENE_PATH, VIEWPORTS, WAREHOUSE, bulkPickPage, bulkPickScene, loaded } from "./kit";

// THE PAGE'S READS (the-bulk-pick-list-prototype-is-accepted) — what it asks the server, against the stub transport
// (.storybook/bulkPickStub.ts), which answers as the contract does (features/picking/bulkPick.ts):
//
//   OrderPickLines      ONE call for the address's ids — only the orders that ship from this warehouse come back
//   StockPickLocations  ONE call naming every take at once (`transactionIds`), never one per order

const Page = bulkPickPage(SCENE_PATH);
/** Order 109 ships from Gudang Cabang (14), not from Gudang Pusat — a link naming it beside 103. */
const WithAnotherBuildingsOrder = bulkPickPage("/warehouse-orders/bulk-pick?ids=103,109");

const meta = {
  title: "Pages/Warehouse/BulkPick/Reads",
  component: BulkPickPage,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: VIEWPORTS } },
  beforeEach: bulkPickScene,
  render: () => <Page />,
} satisfies Meta<typeof BulkPickPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * ONE READ FOR THE ORDERS, ONE FOR EVERY TAKE — the five ids in the address go to OrderPickLines as the warehouse, in
 * their order; their five takes go to StockPickLocations in ONE call (`transactionIds`), never one call per order.
 */
export const OneReadForTheOrdersOneForEveryTake: Story = {
  name: "One read for the orders, one for every take",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await expect(bulkPickScenario.pickLines).toEqual([{ teamId: WAREHOUSE.id, orderIds: [...SCENE] }]);
    await expect(bulkPickScenario.manyTakes).toEqual([
      { warehouseId: WAREHOUSE.id, transactionIds: SCENE.map((id) => pickTransactionOf(id)) },
    ]);
  },
};

/**
 * ANOTHER BUILDING'S ORDER IS NOT LISTED — a link naming 109 (Gudang Cabang's) beside 103: the server answers 103 alone,
 * so the page counts one order and draws one, and 109's take is never asked for.
 */
export const AnotherBuildingsOrderIsNotListed: Story = {
  name: "Another building's order is not listed",
  globals: DESKTOP,
  render: () => <WithAnotherBuildingsOrder />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("bulk-pick-count")).toHaveTextContent("1 order · 3 units");
    await expect(bulkPickScenario.pickLines[0]?.orderIds).toEqual([103n, 109n]);
    await expect(bulkPickScenario.manyTakes).toEqual([{ warehouseId: WAREHOUSE.id, transactionIds: [pickTransactionOf(103n)] }]);
  },
};

/**
 * A FAILED READ IS SAID — the server unreachable: its sentence where the list would be (rpcError's, never the raw Go
 * text), Back still there; no empty hint pretending there was nothing to pick.
 */
export const AFailedReadSaysSo: Story = {
  name: "A failed read says so",
  globals: DESKTOP,
  beforeEach: () => {
    bulkPickScenario.refusal = "selling is unavailable";
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("bulk-pick-error")).toHaveTextContent("The server cannot be reached"), {
      timeout: 5000,
    });
    await expect(canvas.getByTestId("bulk-pick-error")).not.toHaveTextContent("selling is unavailable");
    await expect(canvas.getByTestId("bulk-pick-back")).toBeInTheDocument();
    await expect(canvas.queryByTestId("bulk-pick-empty")).toBeNull();
    await expect(canvas.queryByTestId("bulk-pick-page")).toBeNull();
  },
};
