import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { ORDER_STATUSES } from "../../components/badges/OrderStatusBadge";
import type { OrderStatusId } from "../../components/badges/OrderStatusBadge";

// THE ORDER'S STATUSES, AS THE SELLER'S SCREENS READ THEM — one stage per status (one-tab-per-status).
//
// This file used to be a bridge: the owner's eight decided statuses folded onto a contract that still
// carried the old six, with a colour table of its own because the badge could not key on statuses the
// enum lacked. The enum now carries the eleven (00015), so a stage IS a status: its name and colour are
// `OrderStatusBadge`'s, and nothing here can disagree with the badge in the row.

export type OrderStageId = OrderStatusId;

export interface OrderStage {
  id: OrderStageId;
  /** The one proto status this stage is. */
  status: OrderStatus;
  /** The same status as a list — what the census helpers sum over. */
  statuses: OrderStatus[];
  /** The badge's hue (categorical): a stage looks exactly like its status's badge. */
  color: string;
}

export const ORDER_STAGES: OrderStage[] = ORDER_STATUSES.map((meta) => ({
  id: meta.id,
  status: meta.status,
  statuses: [meta.status],
  color: meta.color,
}));

/** The "no status filter" tab. Not a stage — it is the absence of one. */
export const ALL_STAGE = "all";

export function orderStage(id: string): OrderStage | undefined {
  return ORDER_STAGES.find((stage) => stage.id === id);
}

/** Which stage an order's proto status is. */
export function stageOfStatus(status: OrderStatus): OrderStage | undefined {
  return ORDER_STAGES.find((stage) => stage.status === status);
}
