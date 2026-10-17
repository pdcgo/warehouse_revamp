import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { WarehouseTransferWarehousePage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the warehouse transfer decisions
// (docs/business/inventory/warehouse_transfer_decision.md).
//
// Gudang Pusat (11) is A for 601–607 and 609 (two owners: Toko Melati and Toko Kenanga), and B for 608, which runs the
// other way. Its crew reads the two directions as two jobs, and sees no values.

const Routed = routedPage(
  [
    { path: "/inventories/transfer", element: <WarehouseTransferWarehousePage /> },
    marker("/inventories/transfer/:transferId", "at-transfer-detail"),
    marker("/inventories/transfer/:transferId/accept", "at-transfer-accept"),
  ],
  "/inventories/transfer",
);

const meta = {
  title: "Pages/WarehouseTransfer/TransferWarehouse",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("transfer-row-601", {}, { timeout: 4000 });
  return canvas;
}

export const Outgoing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Two owners' goods leave this building…
    await expect(canvas.getByTestId("transfer-row-609")).toBeInTheDocument();
    // …and the one coming IN is not on the outgoing list.
    await expect(canvas.queryByTestId("transfer-row-608")).toBeNull();
    // The next act is on the row: process a created one, ship a processed one.
    await expect(canvas.getByTestId("transfer-action-process-601")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-action-ship-602")).toBeInTheDocument();
  },
};

export const Incoming: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-direction-incoming"));
    await waitFor(() => expect(canvas.queryByTestId("transfer-row-601")).toBeNull());
    await expect(canvas.getByTestId("transfer-row-608")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-action-accept-608")).toBeInTheDocument();
  },
};

// Accepting is counting, line by line — a page, not a dialog.
export const AcceptOpensTheCount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-direction-incoming"));
    await userEvent.click(await canvas.findByTestId("transfer-action-accept-608"));
    await canvas.findByTestId("at-transfer-accept");
  },
};

// The crew counts boxes; another team's values are not its business.
export const NoValues: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByText(/Rp\s/)).toBeNull();
  },
};
