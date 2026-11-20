import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { orderDetailFor } from "../../../../.storybook/fixtures";
import {
  REPRINT,
  reprintLabelOf,
  reprintLabelScenario,
  withLabelEvents,
} from "../../../../.storybook/reprintLabelScenario";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { EditReceiptDialog } from "../EditReceiptDialog";

// CETAK ULANG LABEL — the SELLER'S side (a-changed-label-asks-the-warehouse-to-reprint, accepted as drawn in
// the-reprint-label-prototype-is-accepted). Edit Resi (the-seller-edits-the-resi-until-handover) on an order whose label
// the warehouse already printed (`Order.label_printed_at_unix` > 0) says, in one line, that saving asks the warehouse to
// print it again; on an order never printed it says nothing. Saving a change is what the server stamps
// (`receipt_changed_at`) — the stub stamps it too, so the order then reads marked.
//
//   | story          | what it pins                                                   |
//   | -------------- | -------------------------------------------------------------- |
//   | Default        | 103 (Toko Melati, printed 3 h ago): the line under the intro    |
//   | SavingMarksIt  | a new number saved → the server stamps the change → marked      |
//   | NeverPrinted   | 101, never printed: no line                                     |

const PRINTED = orderDetailFor(REPRINT.confirmed)!;
const NEVER = orderDetailFor(REPRINT.neverPrinted)!;

function Open({ orderId }: { orderId: bigint }) {
  const [open, setOpen] = useState(true);
  const order = orderDetailFor(orderId)!;

  return <EditReceiptDialog open={open} onOpenChange={setOpen} teamId={order.teamId} orderId={order.id} />;
}

const meta = {
  title: "Features/Orders/EditReceiptDialog/ReprintLabel",
  component: EditReceiptDialog,
  beforeEach: withLabelEvents({ [REPRINT.confirmed.toString()]: { printed: 3 } }),
  args: { open: true, onOpenChange: () => {}, teamId: PRINTED.teamId, orderId: PRINTED.id },
  render: () => <Open orderId={PRINTED.id} />,
} satisfies Meta<typeof EditReceiptDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// PRINTED ALREADY — one line under the intro: saving asks the warehouse to print the label again.
export const Default: Story = {
  name: "Printed already — the warehouse will be asked",
  play: async () => {
    await expect(await screen.findByTestId("edit-receipt-code")).toHaveValue(PRINTED.receiptCode);
    await waitFor(() =>
      expect(screen.getByTestId("edit-receipt-reprint-hint")).toHaveTextContent("The warehouse has already printed this label"),
    );
  },
};

// SAVING A CHANGE MARKS IT — a new number saved on a printed order: the server stamps the change after the print, so the
// warehouse's list, pick page and print page now read *Cetak ulang label* on it.
export const SavingMarksIt: Story = {
  name: "Saving a change marks it for the warehouse",
  play: async () => {
    const code = await screen.findByTestId("edit-receipt-code");
    await expect(reprintLabelOf(PRINTED.id, OrderStatus.PROCESSED)).toBe(false);
    await expect(reprintLabelScenario.printedAt[PRINTED.id.toString()]).toBeDefined();

    await userEvent.clear(code);
    await userEvent.type(code, `${PRINTED.receiptCode}9`, { delay: 10 });
    await userEvent.click(screen.getByTestId("edit-receipt-save"));

    await waitFor(() => expect(screen.queryByTestId("edit-receipt-dialog")).not.toBeInTheDocument());
    await expect(reprintLabelOf(PRINTED.id, OrderStatus.PROCESSED)).toBe(true);
  },
};

// NEVER PRINTED — nothing to say: the first print takes the new label anyway.
export const NeverPrinted: Story = {
  name: "Never printed → nothing",
  args: { open: true, onOpenChange: () => {}, teamId: NEVER.teamId, orderId: NEVER.id },
  render: () => <Open orderId={NEVER.id} />,
  play: async () => {
    await expect(await screen.findByTestId("edit-receipt-code")).toHaveValue(NEVER.receiptCode);
    await expect(screen.queryByTestId("edit-receipt-reprint-hint")).toBeNull();
  },
};
