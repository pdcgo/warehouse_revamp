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
    // An order's take put back, a broken unit, a found unit — each said by its own word (#143, docs/acceptances/
    // inventory/transaction.md givens 2–3). They read Returned and Counted before.
    case MovementKind.CANCEL:
      return t("warehouseProduct.kind.cancel");
    case MovementKind.BROKEN:
      return t("warehouseProduct.kind.broken");
    case MovementKind.FOUND:
      return t("warehouseProduct.kind.found");
    // A price correction moved no unit — said as one on every screen (the-correct-price-prototype-is-accepted).
    case MovementKind.REVALUATION:
      return t("correctPrice.history.kind");
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
    // The kinds #143 split out keep the product pages' words (the-product-history-names-the-transaction names no word
    // of their own for them): a cancel is still Retur there, a broken or a found unit still Penyesuaian.
    case MovementKind.BROKEN:
    case MovementKind.FOUND:
      return t("inventory.transaction.adjustment");
    case MovementKind.RETURN:
    case MovementKind.CANCEL:
      return t("inventory.transaction.return");
    case MovementKind.MOVE:
      return t("inventory.transaction.move");
    case MovementKind.SAMPLE:
      return t("inventory.transaction.sample");
    case MovementKind.REVALUATION:
      return t("correctPrice.history.kind");
    default:
      return t("warehouseProduct.kind.unknown");
  }
}

// THE KIND'S COLOUR, for a ledger that shows it as a badge (owner, on a batch's Riwayat: *"kegiatan pakai badge"*,
// a-movement-kind-is-a-badge). A kind is a CATEGORY, not good or bad, so a hue — and the hues group the kinds by which way
// the units went, so a page of them reads at a glance: IN green, OUT orange, a move between racks blue, a correction grey.
export function kindPalette(kind: MovementKind): "green" | "orange" | "blue" | "gray" {
  switch (kind) {
    case MovementKind.RECEIVE:
    case MovementKind.TRANSFER_IN:
    case MovementKind.RETURN:
    // #143's split kinds sort by the same rule: an order's take put back and a found unit come IN, a broken unit goes
    // OUT of Siap.
    case MovementKind.CANCEL:
    case MovementKind.FOUND:
      return "green";
    case MovementKind.PICK:
    case MovementKind.TRANSFER_OUT:
    case MovementKind.SAMPLE:
    case MovementKind.BROKEN:
      return "orange";
    case MovementKind.MOVE:
      return "blue";
    default:
      // ADJUST and REVALUATION — a count or a price put right, which way it went is its number's.
      return "gray";
  }
}

// THE PUT-AWAYS — the movements that decided goods LIVE somewhere, as opposed to the ones that merely
// changed a count (#197).
//
// RECEIVE appears here AND in the full history, and that is not a mistake: goods arriving both change
// the count and decide where they sit. A MOVE is the purer case — it changes no warehouse total at
// all, only which shelf holds what.
export const PLACEMENT_KINDS = [MovementKind.RECEIVE, MovementKind.MOVE];
