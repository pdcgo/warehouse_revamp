import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Link, Text } from "@chakra-ui/react";

import type { StockBatch } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { BatchOrigin } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { fromHere } from "../../lib/cameFrom";

export const description =
  "Where a batch came from, as a way there — \"Restok #503\" opens that restock's page (no resi: the restock carries it); a return's \"Retur · order #106\" opens that order's warehouse page, where the return was accepted. A click on it never reaches the row it sits in.";

// WHERE A BATCH CAME FROM, AS A WAY THERE (owner: *"batch restoknya tidak resi, tapi bisa redirect ke detailnya, retur
// juga"*, a-batch-opens-where-it-came-from) — the Batch list's row and block, and a batch's page.
//
//   Restok #503            a link to /inventories/restock/503, carrying where it was opened, so Back returns here
//   Retur · order #106     a link to /warehouse-orders/106 — the order whose return minted the batch, on the warehouse's
//                          page of it, where the return was accepted (a-returns-batch-opens-its-order); the batch read
//                          names the order (StockBatch.return_order_id, one read of the order side per page)
//   Retur                  a return no order names yet (its stock went in, the order's move has not landed): plain text
//
// No resi: it is the restock's, one click away on its page, and on a batch's row it was a third fact in a two-line cell.
// The click stops at the link, so the row under it — which opens the batch — does not fire too.
// The same words everywhere — *Restok #503* — since a batch's page now reads it under Info's own *Dari* label
// (a-batch-page-is-one-page-of-sections); its *Dari Restok #503* prefix went with the heading line it sat in.
export function BatchSource({ batch, testId }: { batch: StockBatch; testId?: string }) {
  const { t } = useTranslation();

  if (batch.origin === BatchOrigin.RETURN) {
    if (batch.returnOrderId === 0n) {
      return (
        <Text as="span" data-testid={testId}>
          {t("batches.fromReturn")}
        </Text>
      );
    }

    const orderId = batch.returnOrderId.toString();

    return (
      <SourceLink
        to={`/warehouse-orders/${orderId}`}
        label={t("batches.fromReturnOrder", { id: orderId })}
        testId={testId}
        orderId={orderId}
      />
    );
  }

  // A batch from anything else with no restock number (a transfer in, a count) has nothing to open.
  if (batch.deliveryId === 0n) {
    return (
      <Text as="span" data-testid={testId}>
        —
      </Text>
    );
  }

  const id = batch.deliveryId.toString();

  return <SourceLink to={`/inventories/restock/${id}`} label={t("batches.fromRestock", { id })} testId={testId} />;
}

// One way there, the same for a restock and a return: it carries where it was opened (so Back returns here) and stops
// at the link, so the row under it — which opens the batch — does not fire too.
function SourceLink({ to, label, testId, orderId }: { to: string; label: string; testId?: string; orderId?: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Link
      color="brand.fg"
      whiteSpace="nowrap"
      onClick={(e) => {
        e.stopPropagation();
        navigate(to, { state: fromHere(location) });
      }}
      data-testid={testId}
      data-order-id={orderId}
    >
      {label}
    </Link>
  );
}
