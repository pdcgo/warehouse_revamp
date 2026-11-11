import type { useTranslation } from "react-i18next";
import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";

// The movement kinds, worded ONCE. The ledger stores a number; a person reads a word.
//
// Extracted from WarehouseProductPage for #197, because the rack detail asks the same question of the
// same ledger. Two copies of this switch would drift the first time a kind was added — and the one
// that was missed would render as "unknown" on one screen and correctly on the other, which reads as
// a data problem rather than a missing case.
export function kindLabel(t: ReturnType<typeof useTranslation>["t"], kind: MovementKind): string {
  switch (kind) {
    case MovementKind.RECEIVE:
      return t("warehouseProduct.kind.receive");
    case MovementKind.ADJUST:
      return t("warehouseProduct.kind.adjust");
    case MovementKind.TRANSFER_OUT:
      return t("warehouseProduct.kind.transferOut");
    case MovementKind.TRANSFER_IN:
      return t("warehouseProduct.kind.transferIn");
    case MovementKind.PICK:
      return t("warehouseProduct.kind.pick");
    case MovementKind.MOVE:
      return t("warehouseProduct.kind.move");
    case MovementKind.RETURN:
      return t("warehouseProduct.kind.return");
    case MovementKind.SAMPLE:
      return t("warehouseProduct.kind.sample");
    default:
      return t("warehouseProduct.kind.unknown");
  }
}

// THE SAME KINDS, SAID AS THE TRANSACTION THAT MOVED THE STOCK — Restok, Pesanan, Transfer, Penyesuaian, Retur — for the
// product's pages, read by the selling team (owner: *"diterima diambil itu type transaksi harusnya"*,
// the-product-history-names-the-transaction). The warehouse's screens keep `kindLabel`: there the shelf's work is the
// point. One switch beside the other, so a kind added to one is not missed in the other.
export function transactionLabel(t: ReturnType<typeof useTranslation>["t"], kind: MovementKind): string {
  switch (kind) {
    case MovementKind.RECEIVE:
      return t("inventory.transaction.restock");
    case MovementKind.PICK:
      return t("inventory.transaction.order");
    case MovementKind.TRANSFER_IN:
      return t("inventory.transaction.transferIn");
    case MovementKind.TRANSFER_OUT:
      return t("inventory.transaction.transferOut");
    case MovementKind.ADJUST:
      return t("inventory.transaction.adjustment");
    case MovementKind.RETURN:
      return t("inventory.transaction.return");
    case MovementKind.MOVE:
      return t("inventory.transaction.move");
    case MovementKind.SAMPLE:
      return t("inventory.transaction.sample");
    default:
      return t("warehouseProduct.kind.unknown");
  }
}

// THE PUT-AWAYS — the movements that decided goods LIVE somewhere, as opposed to the ones that merely
// changed a count (#197).
//
// RECEIVE appears here AND in the full history, and that is not a mistake: goods arriving both change
// the count and decide where they sit. A MOVE is the purer case — it changes no warehouse total at
// all, only which shelf holds what.
export const PLACEMENT_KINDS = [MovementKind.RECEIVE, MovementKind.MOVE];
