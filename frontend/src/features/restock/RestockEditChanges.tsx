import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Stack, Text } from "@chakra-ui/react";

import type { RestockLog, RestockLogChange } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockLogChangeField as F } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeamsByIds } from "../teams/queries";
import { useShipmentChannelsByIds } from "../shipment/queries";
import { useFinancialAccountsByIds } from "../financialAccount/queries";
import { useSupplierChannelsByIds, useSuppliersByIds } from "../suppliers/queries";
import { formatRupiahNumber } from "../../lib/money";

// WHAT AN EDIT CHANGED (edits-are-in-the-same-trail) — the lines under an edit's row of the Riwayat: *Kopi Arabika 250g ·
// 10 → 12 pcs · “extra stock”*. The server keeps each changed field before and after (`RestockLog.changes`); this draws
// them in the reader's language, ONE line per thing — a field of the restock, or a product with everything that moved on
// it. A line added names itself, its count and, when given, its supplier (a-line-added-after-arrival-names-its-supplier).
//
// THE WAREHOUSE READS THE BOX, NOT THE PURCHASE (the-warehouse-reads-the-box-not-the-purchase): with `purchase` off — the
// warehouse's page — the price and totals, the supplier and store, the paying account, the Order ID and the shipping are
// left out, as the rest of that page leaves them out; a product whose only change was one of them is not drawn.
//
// An id is named at read time, like the row's person — a warehouse, a courier, an account, a supplier, a store — and one
// that does not resolve names its number. An edit written before the changes were kept has none: nothing is drawn, and
// the row reads as it always did (who and when).

const PURCHASE = new Set<F>([
  F.INVOICE_REF,
  F.FINANCE_ACCOUNT,
  F.SHIPMENT_COST,
  F.LINE_TOTAL,
  F.LINE_SUPPLIER,
  F.LINE_STORE,
]);

/** The names the trail's changes need, looked up once for the whole trail. */
export interface TrailNames {
  warehouse: (id: string) => string;
  courier: (id: string) => string;
  account: (id: string) => string;
  supplier: (id: string) => string;
  store: (id: string) => string;
}

const idsOf = (logs: RestockLog[], fields: F[]): bigint[] => {
  const out: bigint[] = [];
  for (const log of logs) {
    for (const c of log.changes) {
      if (!fields.includes(c.field)) continue;
      for (const v of [c.before, c.after]) if (/^\d+$/.test(v)) out.push(BigInt(v));
    }
  }

  return out;
};

// ONE lookup per kind for the whole trail — and none of the purchase's on the warehouse's page, whose team may not read
// the selling team's accounts (FinancialAccountByIds is scoped to the owning team).
export function useTrailNames(logs: RestockLog[], teamId: bigint | undefined, purchase: boolean): TrailNames {
  const { t } = useTranslation();
  const teams = useTeamsByIds({ ids: idsOf(logs, [F.WAREHOUSE]) });
  const couriers = useShipmentChannelsByIds(idsOf(logs, [F.SHIPMENT]));
  const accounts = useFinancialAccountsByIds(purchase ? teamId : undefined, purchase ? idsOf(logs, [F.FINANCE_ACCOUNT]) : []);
  const suppliers = useSuppliersByIds({
    teamId: purchase ? teamId : undefined,
    supplierIds: purchase ? idsOf(logs, [F.LINE_SUPPLIER]) : [],
  });
  const stores = useSupplierChannelsByIds({
    teamId: purchase ? teamId : undefined,
    channelIds: purchase ? idsOf(logs, [F.LINE_STORE]) : [],
  });

  return {
    warehouse: (id) => teams.data?.[id]?.name ?? t("restock.timeline.change.unknownWarehouse", { id }),
    courier: (id) => couriers.data?.get(id)?.name ?? t("restock.timeline.change.unknownCourier", { id }),
    account: (id) => accounts.data?.get(id)?.name ?? t("restock.timeline.change.unknownAccount", { id }),
    supplier: (id) => suppliers.data?.get(id)?.name ?? t("restock.lineSupplier.unknownSupplier", { id }),
    store: (id) => (stores.data as Record<string, { name: string }> | undefined)?.[id]?.name ?? t("restock.lineSupplier.unknownStore", { id }),
  };
}

/** One drawn line: a field of the restock, or a product and what moved on it. */
interface ChangeLine {
  key: string;
  field: string;
  text: string;
}

export function RestockEditChanges({
  changes,
  names,
  purchase,
  testId,
}: {
  changes: RestockLogChange[];
  names: TrailNames;
  purchase: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const none = t("restock.timeline.change.none");
  const shown = changes.filter((c) => purchase || !PURCHASE.has(c.field));

  const or = (v: string, named?: (id: string) => string) => (v === "" ? none : named ? named(v) : v);
  const money = (v: string) => (v === "" ? none : formatRupiahNumber(Number(v)));
  const moved = (c: RestockLogChange, named?: (id: string) => string) => ({ from: or(c.before, named), to: or(c.after, named) });

  const lines: ChangeLine[] = [];

  // The restock's own fields, in the order the server wrote them.
  for (const c of shown) {
    if (c.productId !== 0n) continue;

    let text = "";
    switch (c.field) {
      case F.WAREHOUSE:
        text = t("restock.timeline.change.warehouse", moved(c, names.warehouse));
        break;
      case F.RECEIPT:
        text = t("restock.timeline.change.receipt", moved(c));
        break;
      case F.RECEIPT_FILE:
        // A document id says nothing to a person: the photo came, went or was swapped.
        text = t(
          c.before === ""
            ? "restock.timeline.change.receiptFileAdded"
            : c.after === ""
              ? "restock.timeline.change.receiptFileRemoved"
              : "restock.timeline.change.receiptFileReplaced",
        );
        break;
      case F.SHIPMENT:
        text = t("restock.timeline.change.shipment", moved(c, names.courier));
        break;
      case F.INVOICE_REF:
        text = t("restock.timeline.change.invoiceRef", moved(c));
        break;
      case F.FINANCE_ACCOUNT:
        text = t("restock.timeline.change.account", moved(c, names.account));
        break;
      case F.SHIPMENT_COST:
        text = t("restock.timeline.change.shipmentCost", { from: money(c.before), to: money(c.after) });
        break;
      case F.NOTE:
        text = noteText(t, "restock.timeline.change.note", c);
        break;
      // The receiving warehouse's own note (the-warehouse-writes-its-own-note) — the box's side, so both pages draw it.
      case F.WAREHOUSE_NOTE:
        text = noteText(t, "restock.timeline.change.warehouseNote", c);
        break;
      default:
        continue;
    }
    lines.push({ key: fieldKey(c.field), field: fieldKey(c.field), text });
  }

  // Then the lines, one per product, in the order the server wrote them.
  const products: bigint[] = [];
  for (const c of shown) if (c.productId !== 0n && !products.includes(c.productId)) products.push(c.productId);

  for (const productId of products) {
    const mine = shown.filter((c) => c.productId === productId);
    const name = mine[0]!.productName;
    const of = (field: F) => mine.find((c) => c.field === field);
    const parts: string[] = [];

    const added = of(F.LINE_ADDED);
    const removed = of(F.LINE_REMOVED);
    const total = of(F.LINE_TOTAL);
    const supplier = of(F.LINE_SUPPLIER);
    const store = of(F.LINE_STORE);
    const note = of(F.LINE_NOTE);
    const count = of(F.LINE_COUNT);

    let head = name;
    let field = "line";
    if (added) {
      head = t("restock.timeline.change.lineAdded", { name, count: added.after });
      field = "line_added";
    } else if (removed) {
      head = t("restock.timeline.change.lineRemoved", { name, count: removed.before });
      field = "line_removed";
    } else if (count) {
      parts.push(t("restock.timeline.change.count", { from: count.before, to: count.after }));
    }

    if (added) {
      // What came with it: its total, then — when given — who sold it and from which store.
      if (total) parts.push(money(total.after));
      if (supplier) parts.push(t("restock.timeline.change.supplierSet", { to: names.supplier(supplier.after) }));
      if (store) parts.push(t("restock.timeline.change.storeSet", { to: names.store(store.after) }));
    } else if (!removed) {
      if (total) parts.push(t("restock.timeline.change.total", { from: money(total.before), to: money(total.after) }));
      if (supplier) parts.push(t("restock.timeline.change.supplier", moved(supplier, names.supplier)));
      if (store) parts.push(t("restock.timeline.change.store", moved(store, names.store)));
    }
    if (note && !removed) parts.push(noteText(t, "restock.timeline.change.lineNote", note));

    // Nothing to say about it here (its only change was the purchase's, on the warehouse's page): not drawn.
    if (!added && !removed && parts.length === 0) continue;

    lines.push({ key: `line-${productId}`, field, text: [head, ...parts].join(" · ") });
  }

  if (lines.length === 0) return null;

  return (
    <Stack gap="0.5" minW="0" data-testid={`${testId}-changes`}>
      {lines.map((line) => (
        <Text
          key={line.key}
          fontSize="sm"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          data-testid={`${testId}-change-${line.key}`}
          data-field={line.field}
        >
          {line.text}
        </Text>
      ))}
    </Stack>
  );
}

// A note's change: written where there was none, rewritten, or cleared.
function noteText(t: TFunction, base: string, c: RestockLogChange): string {
  if (c.before === "") return t(`${base}Set`, { to: c.after });
  if (c.after === "") return t(`${base}Removed`);

  return t(`${base}Changed`, { from: c.before, to: c.after });
}

// The test id of a field of the restock — its stored word.
function fieldKey(field: F): string {
  switch (field) {
    case F.WAREHOUSE:
      return "warehouse";
    case F.RECEIPT:
      return "receipt";
    case F.RECEIPT_FILE:
      return "receipt_file";
    case F.SHIPMENT:
      return "shipment";
    case F.INVOICE_REF:
      return "invoice_ref";
    case F.FINANCE_ACCOUNT:
      return "finance_account";
    case F.SHIPMENT_COST:
      return "shipment_cost";
    case F.NOTE:
      return "note";
    case F.WAREHOUSE_NOTE:
      return "warehouse_note";
    default:
      return "other";
  }
}
