import { useState } from "react";
import { useTranslation } from "react-i18next";

import { documentClient, orderClient, rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { OrderLabelReason } from "../../gen/warehouse/selling/v1/order_pb";
import type { Order } from "../../gen/warehouse/selling/v1/order_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";

/** What the screen says when an order's label is not behind the link. */
const REFUSAL: Record<OrderLabelReason, string> = {
  [OrderLabelReason.UNSPECIFIED]: "orders.label.refused",
  [OrderLabelReason.NOT_SHIPPED_HERE]: "orders.label.notShippedHere",
  [OrderLabelReason.NO_LABEL]: "orders.label.noLabel",
};

/**
 * Whether this team opens a label through the ORDER (OrderLabels) rather than as the document's owner
 * (GetDownloadUrl): the warehouse that ships it, and Root — neither owns the seller's file.
 */
export function readsLabelsThroughTheOrder(teamType: TeamType | number | undefined): boolean {
  return teamType === TeamType.WAREHOUSE || teamType === TeamType.ROOT;
}

// OPENING AN ORDER'S SHIPPING LABEL. The label is the SELLER's document, uploaded under its team, so:
//
//   - the seller opens it as its owner — document_service's GetDownloadUrl;
//   - the warehouse that ships the order (and Root) asks the ORDER — OrderLabels — which checks the order ships from
//     the caller's warehouse and has the link minted under the order service's identity
//     (a-warehouse-prints-the-labels-of-orders-it-ships). Asking GetDownloadUrl as the warehouse is NotFound: that was
//     the bug, Print Label failing on every order.
//
// The link is fetched at the moment somebody asks — a signed URL resolved on page load would quietly expire while the
// page sat open. A refusal says why (another warehouse's order, no label) instead of opening nothing.
export function useOrderLabels() {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);

  async function openLabel(args: { teamId: bigint | undefined; teamType: TeamType | number | undefined; order: Order }) {
    const { teamId, teamType, order } = args;
    const documentId = order.receipt?.documentId;

    if (teamId === undefined || !documentId) return;

    setOpening(true);

    try {
      if (!readsLabelsThroughTheOrder(teamType)) {
        const res = await documentClient.getDownloadUrl({ teamId, documentId });
        window.open(res.url, "_blank", "noopener,noreferrer");

        return;
      }

      const res = await orderClient.orderLabels({ teamId, orderIds: [order.id] });
      const result = res.results.find((r) => r.orderId === order.id);

      if (!result?.included || !res.url) {
        toaster.create({ type: "error", title: t(REFUSAL[result?.reason ?? OrderLabelReason.UNSPECIFIED], { id: order.id.toString() }) });

        return;
      }

      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    } finally {
      setOpening(false);
    }
  }

  return { openLabel, opening };
}
