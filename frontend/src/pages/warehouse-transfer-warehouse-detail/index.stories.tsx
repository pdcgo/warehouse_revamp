import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { transferWire } from "../../../.storybook/warehouseTransferStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WarehouseTransferWarehouseDetailPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the warehouse transfer decisions
// (docs/business/inventory/warehouse_transfer_decision.md). One transfer as a WAREHOUSE reads it: Gudang Pusat (11) is
// A for 601–607, Gudang Cabang (14) is their B.

function routedAt(id: bigint) {
  return routedPage(
    [
      { path: "/inventories/transfer/:transferId", element: <WarehouseTransferWarehouseDetailPage /> },
      marker("/inventories/transfer", "at-transfer-list"),
      marker("/inventories/transfer/:transferId/accept", "at-transfer-accept"),
    ],
    `/inventories/transfer/${id}`,
  );
}

const At601 = routedAt(601n);
const At604 = routedAt(604n);
const At605 = routedAt(605n);

const meta = {
  title: "Pages/WarehouseTransfer/TransferWarehouseDetail",
  component: At601,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// A's view of a created transfer: the PICK LIST — which racks to take each product from, chosen at create — and the
// next act, Process. No values.
export const SenderSeesThePickList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("transfer-detail-side")).toHaveTextContent(/outgoing/i);
    await waitFor(() => expect(canvas.getByTestId("transfer-line-6011-picks")).toHaveTextContent("A-01-1 × 4"));
    await expect(canvas.getByTestId("transfer-line-6011-picks")).toHaveTextContent("A-01-2 × 6");
    await expect(canvas.getByTestId("transfer-action-process-601")).toBeInTheDocument();
    await expect(canvas.queryByText(/Rp\s/)).toBeNull();
  },
};

// Processing confirms, and the team loses its cancel.
export const Process: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("transfer-action-process-601"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await waitFor(() => expect(transferWire(601n).status).toBe(WarehouseTransferStatus.PROCESS));
    await waitFor(() => expect(canvas.getByTestId("transfer-action-ship-601")).toBeInTheDocument());
  },
};

// B's view of a box at its door: Accept opens the count.
export const ReceiverAccepts: Story = {
  render: () => <At604 />,
  beforeEach: () => {
    asTeam(14n)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("transfer-detail-side")).toHaveTextContent(/incoming/i);
    await userEvent.click(canvas.getByTestId("transfer-action-accept-604"));
    await canvas.findByTestId("at-transfer-accept");
  },
};

// B's view once accepted: where the good units went, and what was broken or missing.
export const ReceiverAfterTheCount: Story = {
  render: () => <At605 />,
  beforeEach: () => {
    asTeam(14n)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("transfer-line-6051-put-away")).toHaveTextContent("C-01-1 × 4"));
    await expect(canvas.getByTestId("transfer-detail-on-site")).toHaveTextContent("5.000");
  },
};
