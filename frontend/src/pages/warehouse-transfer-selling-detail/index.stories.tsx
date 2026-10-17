import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { transferWire } from "../../../.storybook/warehouseTransferStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WarehouseTransferSellingDetailPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the warehouse transfer decisions
// (docs/business/inventory/warehouse_transfer_decision.md). One transfer as Toko Melati (12), its owner, reads it.

function routedAt(id: bigint) {
  return routedPage(
    [
      { path: "/inventories/transfer/:transferId", element: <WarehouseTransferSellingDetailPage /> },
      marker("/inventories/transfer", "at-transfer-list"),
    ],
    `/inventories/transfer/${id}`,
  );
}

const At601 = routedAt(601n);
const At603 = routedAt(603n);
const At605 = routedAt(605n);
const At609 = routedAt(609n);

const meta = {
  title: "Pages/WarehouseTransfer/TransferSellingDetail",
  component: At601,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Created: no courier yet, no cost yet — the team may cancel, or type the cost.
export const Created: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("transfer-detail-title")).toHaveTextContent("601");
    await expect(canvas.getByTestId("transfer-action-cancel-601")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-detail-shipping-cost")).toHaveTextContent(/not yet/i);
    // The value the system filled — the owner reads it.
    await expect(canvas.getByTestId("transfer-detail-total")).toHaveTextContent("890.000");
  },
};

// Shipped: the courier and tracking number A entered, the cost and its account the team entered.
export const Shipped: Story = {
  render: () => <At603 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("transfer-detail-tracking")).toHaveTextContent("JNE7788990011");
    await expect(canvas.getByTestId("transfer-detail-shipping-cost")).toHaveTextContent("18.000");
    await expect(canvas.getByTestId("transfer-action-mark-lost-603")).toBeInTheDocument();
  },
};

// Accepted with problems: broken and missing on the lines, what they were worth — the team's loss — and the courier's
// charge B paid at its door.
export const AcceptedWithProblems: Story = {
  render: () => <At605 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("transfer-detail-problems")).toHaveTextContent("2");
    await expect(canvas.getByTestId("transfer-detail-loss")).toHaveTextContent("130.000");
    await expect(canvas.getByTestId("transfer-detail-on-site")).toHaveTextContent("5.000");
    await expect(canvas.queryByTestId(/transfer-action-/)).toBeNull();
  },
};

// Another team's transfer reads as not found — never "forbidden".
export const AnotherTeamsReadsNotFound: Story = {
  render: () => <At609 />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("transfer-detail-error")).toBeInTheDocument();
  },
};

// Marking a shipped box lost reaches the server.
export const MarkLost: Story = {
  render: () => <At603 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("transfer-action-mark-lost-603"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await waitFor(() => expect(transferWire(603n).status).toBe(WarehouseTransferStatus.LOST));
    await waitFor(() => expect(canvas.getByTestId("transfer-detail-status")).toHaveTextContent(/lost/i));
  },
};
