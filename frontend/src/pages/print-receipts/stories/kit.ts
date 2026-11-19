import { orderDetailExtras, orders } from "../../../../.storybook/fixtures";

// WHAT THE PRINT PAGE'S AND THE HANDOVER'S STORIES SHARE (the-print-page-and-the-courier-count-prototype-is-accepted) —
// fixture knobs, each returning its restore, so a story's `beforeEach` leaves the shared fixtures as it found them. The
// handover's Per kurir stories live with the list's (Pages/Warehouse/PickQueuePage).

/** These orders carry a label file — on their read (OrderPrintByIds' `hasLabel`) and in OrderLabels, which reads the same file. */
export function withLabels(...ids: bigint[]): () => void {
  const before = ids.map((id) => [id.toString(), orderDetailExtras[id.toString()]] as const);
  for (const id of ids) {
    const k = id.toString();
    orderDetailExtras[k] = {
      ...(orderDetailExtras[k] ?? {}),
      receipt: { documentId: `doc-${k}`, filename: `resi-${k}.pdf`, mimeType: "application/pdf" },
    };
  }

  return () => {
    for (const [k, was] of before) {
      if (was === undefined) delete orderDetailExtras[k];
      else orderDetailExtras[k] = was;
    }
  };
}

/**
 * 110 ships with J&T (92) — its fixture names #95, an id the courier catalogue does not hold, which a badge draws as
 * `#95`. The stories show every courier by name.
 */
export function on110AsJnt(): () => void {
  const order = orders.find((o) => o.id === 110n)!;
  const was = order.shipmentChannelId;
  order.shipmentChannelId = 92n;

  return () => {
    order.shipmentChannelId = was;
  };
}
