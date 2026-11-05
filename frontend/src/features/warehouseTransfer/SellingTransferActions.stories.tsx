import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { archiveAccountForStory } from "../../../.storybook/financialAccountStub";
import { transferWire } from "../../../.storybook/warehouseTransferStub";
import { SellingTransferActions } from "./SellingTransferActions";
import { storyTransfer } from "./storyTransfer";

// WHAT THE SELLING TEAM MAY DO, by status (cancel-before-processed-lost-only-in-transit): created → Edit Cost, Cancel;
// shipped → Edit Cost, Mark Lost; process, arrived, lost → Edit Cost; accepted and cancelled → nothing — never a
// disabled button the server would refuse.
const meta = {
  title: "Features/WarehouseTransfer/SellingTransferActions",
  component: SellingTransferActions,
  parameters: { signedIn: true },
  args: { teamId: 12n, variant: "buttons", transfer: storyTransfer(601n) },
} satisfies Meta<typeof SellingTransferActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Created: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-action-edit-cost-601")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-action-cancel-601")).toBeInTheDocument();
    await expect(canvas.queryByTestId("transfer-action-mark-lost-601")).toBeNull();
  },
};

// Once Warehouse A confirms, the cancel is gone — the goods are being picked.
export const ProcessHasNoCancel: Story = {
  args: { transfer: storyTransfer(602n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-action-edit-cost-602")).toBeInTheDocument();
    await expect(canvas.queryByTestId("transfer-action-cancel-602")).toBeNull();
  },
};

// Only while the box is with the courier can it be given up.
export const ShippedMayBeMarkedLost: Story = {
  args: { transfer: storyTransfer(603n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-action-mark-lost-603")).toBeInTheDocument();
    await expect(canvas.queryByTestId("transfer-action-cancel-603")).toBeNull();
  },
};

export const AcceptedHasNone: Story = {
  args: { transfer: storyTransfer(605n) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId(/transfer-action-/)).toBeNull();
  },
};

export const AsAMenu: Story = { args: { variant: "menu" } };

// Cancelling reaches the server and moves the transfer to cancelled — the stub plays the rule.
export const CancelCallsTheServer: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("transfer-action-cancel-601"));
    await userEvent.type(await screen.findByTestId("transfer-cancel-reason"), "Salah gudang", { delay: 20 });
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(transferWire(601n).status).toBe(WarehouseTransferStatus.CANCELLED));
    await expect(transferWire(601n).logs.at(-1)?.description).toBe("Salah gudang");
  },
};

// A cost needs the account that pays it (a-transfer-names-its-paying-account): with a cost and no account, Save waits.
export const ACostNeedsAnAccount: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("transfer-action-edit-cost-601"));
    await userEvent.type(await screen.findByTestId("transfer-cost-amount"), "18000", { delay: 20 });

    await waitFor(() => expect(screen.getByTestId("confirm-action")).toBeDisabled());
    // The cost posts into the paying account (built), so the field carries no pending mark.
    await expect(screen.queryByTestId("not-implemented-costEvent")).toBeNull();
  },
};

// Moving the shipping to another account is judged like a restock's: it must be one of the team's ACTIVE OPERATIONAL
// accounts (a-transfer-names-its-paying-account). ShopeePay Melati is picked, then an admin unmarks it before Save: the
// server refuses, naming it, and the transfer keeps no cost and no account.
export const ARefusedPayingAccountIsSaid: Story = {
  play: async ({ canvasElement }) => {
    const SHOPEEPAY = 1303n;

    await userEvent.click(within(canvasElement).getByTestId("transfer-action-edit-cost-601"));
    await userEvent.type(await screen.findByTestId("transfer-cost-amount"), "18000", { delay: 20 });

    await userEvent.click(screen.getByTestId("transfer-cost-account"));
    const option = await screen.findByTestId(`transfer-cost-account-option-${SHOPEEPAY}`, {}, { timeout: 4000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    archiveAccountForStory(SHOPEEPAY);

    await waitFor(() => expect(screen.getByTestId("confirm-action")).toBeEnabled());
    await userEvent.click(screen.getByTestId("confirm-action"));

    await expect(
      await screen.findByText(
        "ShopeePay Melati is archived — it is not one of the team's active accounts",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    await expect(transferWire(601n).financeAccountId).toBe(0n);
    await expect(transferWire(601n).shipmentCost).toBe(0);
  },
};
