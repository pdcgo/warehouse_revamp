import type { OrderDraft } from "../../gen/warehouse/selling/v1/order_draft_pb";
import type { PickedProduct } from "../../components/products/ProductSelect";
import type { Availability, Costs, LineDraft } from "../../features/orders/lines";
import { lineFor, lineStock, lineTotal, toQty, toRupiah } from "../../features/orders/lines";
import type { BundleDraft } from "../../features/orders/form/bundles";
import { bundleFor, slotCap, slotFilled } from "../../features/orders/form/bundles";
import type { BundleTemplate } from "../../features/orders/form/mockData";

// ONE SCRAPED ROW, AND WHAT IT BECOMES (`a-draft-row-maps-to-a-product-a-bundle-or-a-split`).
//
// A row is one listing the app read off the marketplace — "Kopi Arabika 250g × 2", or "Paket Hemat
// Kopi + Teh × 1". What leaves the warehouse for it is one of three things:
//
//   product   one of our products, at the row's quantity
//   bundle    a bundle template, its slots filled — slot cap = rule × the row's quantity
//   split     several products directly, each at a quantity PER LISTING UNIT (× the row's quantity),
//             for a listing no bundle describes — the screen suggests making it a bundle
//
// ⚠ WHAT THE APP READ IS INFORMATION (owner: *"harga cuma info, jumlah pun cuma info, tapi bisa jadi
// indicator warning jika jumlahnya tidak sesuai"*). The listing's quantity and price are shown, not
// edited. What leaves the warehouse is set in the MAPPING — the product's quantity, or how many bundles —
// and a mapping whose count differs from the listing's is flagged, never refused.
//
// ⚠ ONLY `product` IS STORED. A draft line has one `product_id`; a bundle or a split is shown and
// counted (stock, HPP, profit) and saved as UNMAPPED, and it blocks Promote until the draft line can
// hold it. That is the `rowBundle` / `rowSplit` marks.

export type RowMode = "product" | "bundle" | "split";

export interface DraftRow {
  /** Stable while editing: the draft line's id, or a local key for a row added here. */
  key: string;
  /** The draft line's id; `0n` for a row added on this screen (saved as a NEW line). */
  itemId: bigint;
  externalSku: string;
  externalName: string;
  /** Units of the LISTING the buyer bought, as the app read it — information. */
  quantity: string;
  /** What the platform charged per listing unit (the draft's `unit_price`) — information. */
  mpPrice: string;
  /**
   * HOW MANY the mapping sends — the product's quantity, or the number of bundles. Starts at the listing's
   * quantity; a different one is allowed and flagged (`rowCountDiffers`). A split has no count: its parts
   * are per listing unit.
   */
  count: string;
  mode: RowMode;
  /** mode `product`: the mapped product, or null while unmapped. Its quantity is ignored — the row's rules. */
  product: LineDraft | null;
  /** mode `bundle`: the chosen bundle, or null while none is picked. Its quantity follows the row. */
  bundle: BundleDraft | null;
  /** mode `split`: the products, each at a quantity PER LISTING UNIT. */
  parts: LineDraft[];
}

/** The draft's lines as rows — every one in `product` mode, which is all a draft can store. */
export function rowsFromDraft(draft: OrderDraft): DraftRow[] {
  return draft.items.map((item) => ({
    key: `row-${item.id}`,
    itemId: item.id,
    externalSku: item.externalSku,
    externalName: item.externalName,
    quantity: String(item.quantity),
    mpPrice: item.unitPrice > 0n ? item.unitPrice.toString() : "",
    count: String(item.quantity),
    mode: "product",
    // A mapped line names its product by id only; the page fills sku and name from its by-ids read.
    product:
      item.productId > 0n
        ? { productId: item.productId, sku: "", name: "", imageUrl: "", thumbnailUrl: "", quantity: "1" }
        : null,
    bundle: null,
    parts: [],
  }));
}

/** A row somebody adds here — something the scrape never read, so it has no scraped text. */
export function emptyRow(key: string): DraftRow {
  return {
    key,
    itemId: 0n,
    externalSku: "",
    externalName: "",
    quantity: "1",
    mpPrice: "",
    count: "1",
    mode: "product",
    product: null,
    bundle: null,
    parts: [],
  };
}

export function productFor(picked: PickedProduct): LineDraft {
  return lineFor(picked);
}

/**
 * A bundle mapped onto a row. Its quantity is the row's count, and each slot starts full for it —
 * rule × count — because that is what the listing says was bought.
 */
export function bundleForRow(template: BundleTemplate, row: DraftRow): BundleDraft {
  const bundle = bundleFor(template, `${row.key}-bundle`);
  const qty = Math.max(1, toQty(row.count));

  return {
    ...bundle,
    quantity: String(qty),
    slots: bundle.slots.map((slot) => ({
      ...slot,
      fills: slot.fills.map((fill) => ({ ...fill, quantity: String(slot.ruleQty * qty) })),
    })),
  };
}

/** Every product line this row puts on the order, at absolute quantities. */
export function rowLines(row: DraftRow): LineDraft[] {
  const qty = toQty(row.quantity);

  switch (row.mode) {
    case "product":
      return row.product && row.product.productId > 0n
        ? [{ ...row.product, quantity: row.count }]
        : [];
    case "bundle":
      return row.bundle ? row.bundle.slots.flatMap((slot) => slot.fills) : [];
    case "split":
      return row.parts
        .filter((part) => part.productId > 0n)
        .map((part) => ({ ...part, quantity: String(toQty(part.quantity) * qty) }));
  }
}

/** Whether the row says what leaves the warehouse — every product chosen, every slot at its cap. */
export function rowMapped(row: DraftRow): boolean {
  switch (row.mode) {
    case "product":
      return row.product !== null && row.product.productId > 0n && toQty(row.count) >= 1;
    case "bundle":
      return (
        row.bundle !== null &&
        row.bundle.slots.every((slot) => slotFilled(slot) === slotCap(slot, row.bundle!.quantity))
      );
    case "split":
      return row.parts.length > 0 && row.parts.every((p) => p.productId > 0n && toQty(p.quantity) >= 1);
  }
}

/**
 * WHETHER THE MAPPING SENDS A DIFFERENT COUNT FROM THE LISTING — a warning, never a refusal: the buyer may
 * have asked for less by message, or the scrape misread the number.
 */
export function rowCountDiffers(row: DraftRow): boolean {
  if (row.mode === "split") return false;
  if (row.mode === "product" && !(row.product && row.product.productId > 0n)) return false;
  if (row.mode === "bundle" && !row.bundle) return false;

  return toQty(row.count) !== toQty(row.quantity);
}

/** The quantity a row SAVES as — its count, or for a split the listing's quantity. */
export function rowSavedQuantity(row: DraftRow): number {
  return toQty(row.mode === "split" ? row.quantity : row.count);
}

/** What the platform charged for the whole row. */
export function rowMpTotal(row: DraftRow): bigint {
  return toRupiah(row.mpPrice) * BigInt(toQty(row.quantity));
}

/** What the row's goods cost at HPP — unknown costs count as nothing, as everywhere else. */
export function rowHpp(row: DraftRow, costs: Costs | undefined): bigint {
  return rowLines(row).reduce((sum, line) => sum + lineTotal(line, costs), 0n);
}

/** Whether any of the row's products is short in the chosen warehouse. */
export function rowShort(row: DraftRow, stock: Availability | undefined): boolean {
  return rowLines(row).some((line) => {
    const s = lineStock(line, stock);
    return s.kind === "known" && s.short;
  });
}

/** The product id a row SAVES as — only a product-mode mapping; a bundle or a split saves unmapped. */
export function rowSavedProduct(row: DraftRow): bigint {
  return row.mode === "product" && row.product ? row.product.productId : 0n;
}

/** Whether two row lists are the same edit AS A DRAFT STORES IT. */
export function sameStoredRows(a: DraftRow[], b: DraftRow[]): boolean {
  if (a.length !== b.length) return false;

  return a.every((row, i) => {
    const other = b[i]!;

    return (
      row.key === other.key &&
      rowSavedProduct(row) === rowSavedProduct(other) &&
      rowSavedQuantity(row) === rowSavedQuantity(other)
    );
  });
}
