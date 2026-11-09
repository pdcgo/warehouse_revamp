import { useTranslation } from "react-i18next";

import type { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatusBadge } from "../../../components/badges/OrderStatusBadge";
import { warehouseLabelKey } from "../tabs";

/** The status badge in the warehouse's words — the tab's name for its steps, the order status's after (warehouseLabelKey). */
export function WarehouseStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const key = warehouseLabelKey(status);

  return <OrderStatusBadge status={status} label={key ? t(key) : undefined} />;
}
