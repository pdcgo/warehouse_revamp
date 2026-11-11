import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { orderStatusLabelKey } from "../../components/badges/OrderStatusBadge";

// THE WAREHOUSE'S TABS ARE THE STEPS OF ITS WORK, not the order's statuses (owner —
// `the-warehouse-tabs-are-the-processed-steps`). The order's statuses (Menunggu, Dikirim, …) are what a
// seller and a buyer read; inside the building the order is one of the warehouse's steps, preceded by the
// job it must accept first, and followed by the parcels coming back. Each step IS an order status now (00015),
// so every tab narrows the list and carries its count:
//
//   Perlu konfirmasi   pending — the warehouse's first job, so the screen opens here
//   Dikonfirmasi       processed — confirmed, being picked
//   Sudah diambil      picked — waiting for the handover
//   Sudah diserahkan   shipping — handed to the courier
//   Retur              return + return_completed — on their way back, and accepted (the-warehouse-list-has-a-returns-tab)
//   Semua              not a status — no narrowing, for looking an old order up
//
// "Sedang diambil" and "Dikemas" are gone with the statuses that held them: being picked is processed,
// and packed is picked.
export interface WarehouseTab {
  id: string;
  labelKey: string;
  /** UNSPECIFIED: no narrowing — unless `statuses` names several. */
  status: OrderStatus;
  /** A tab that is more than one status — Retur. */
  statuses?: OrderStatus[];
}

export const WAREHOUSE_TABS: WarehouseTab[] = [
  { id: "toConfirm", labelKey: "warehouseOrders.tab.toConfirm", status: OrderStatus.PENDING },
  { id: "confirm", labelKey: "orders.step.confirm", status: OrderStatus.PROCESSED },
  { id: "picked", labelKey: "orders.step.picked", status: OrderStatus.PICKED },
  { id: "handover", labelKey: "orders.step.handover", status: OrderStatus.SHIPPING },
  // THE RETURNS ADDRESSED TO THIS WAREHOUSE — the ones it shipped and the ones its sellers send back to it as their
  // configured return warehouse; the server's scope decides which (orderReaders).
  {
    id: "return",
    labelKey: "picking.tab.return",
    status: OrderStatus.UNSPECIFIED,
    statuses: [OrderStatus.RETURN, OrderStatus.RETURN_COMPLETED],
  },
  { id: "all", labelKey: "warehouseOrders.tab.all", status: OrderStatus.UNSPECIFIED },
];

/**
 * The name a row's status badge carries — the tab's, so a row reads what the tab above it says. An order
 * the warehouse is done with keeps its order status's name (Dikirim, Batal, Retur).
 */
export function warehouseLabelKey(status: OrderStatus): string | undefined {
  const tab = WAREHOUSE_TABS.find((item) => item.status === status && status !== OrderStatus.UNSPECIFIED);
  if (tab) return tab.labelKey;
  return orderStatusLabelKey(status);
}
