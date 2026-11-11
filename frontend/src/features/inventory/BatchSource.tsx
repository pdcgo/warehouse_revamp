import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { HStack, Link, Text } from "@chakra-ui/react";

import type { StockBatch } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { BatchOrigin } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { NotImplemented } from "../pending/NotImplemented";
import { fromHere } from "../../lib/cameFrom";
import { BATCH_PENDING } from "./pending";

export const description =
  "Where a batch came from, as a way there — \"Restok #503\" opens that restock's page (no resi: the restock carries it); a return's \"Retur\" carries a ⚠ until a batch knows its return's number. A click on it never reaches the row it sits in.";

// WHERE A BATCH CAME FROM, AS A WAY THERE (owner: *"batch restoknya tidak resi, tapi bisa redirect ke detailnya, retur
// juga"*, a-batch-opens-where-it-came-from) — the Batch list's row and block, and a batch's page.
//
//   Restok #503       a link to /inventories/restock/503, carrying where it was opened, so Back returns here
//   Retur ⚠1          the return's page cannot be named yet — the batch read carries no return number (pending.ts)
//
// No resi: it is the restock's, one click away on its page, and on a batch's row it was a third fact in a two-line cell.
// The click stops at the link, so the row under it — which opens the batch — does not fire too.
// The same words everywhere — *Restok #503* — since a batch's page now reads it under Info's own *Dari* label
// (a-batch-page-is-one-page-of-sections); its *Dari Restok #503* prefix went with the heading line it sat in.
export function BatchSource({ batch, testId }: { batch: StockBatch; testId?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  if (batch.origin === BatchOrigin.RETURN) {
    return (
      <HStack as="span" gap="1" display="inline-flex" data-testid={testId}>
        <Text as="span">{t("batches.fromReturn")}</Text>
        <NotImplemented list={BATCH_PENDING} id="returnLink" />
      </HStack>
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

  return (
    <Link
      color="brand.fg"
      whiteSpace="nowrap"
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/inventories/restock/${id}`, { state: fromHere(location) });
      }}
      data-testid={testId}
    >
      {t("batches.fromRestock", { id })}
    </Link>
  );
}
