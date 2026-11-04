import {
  type RestockRequest,
  type RestockRequestItem,
  RestockRequestStatus,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import type { PickedProduct } from "../../components/products/ProductSelect";
import { toRupiah } from "../../features/restock/counting";

// The restock form's rules, in one place — the page reads them and so do its stories, and a second copy of "what may
// change while the box is at the door" is how the screen and the server start disagreeing.

/**
 * What the form may change — a fact of the restock's STATUS, never of who is looking:
 *
 *   create   → a new restock: everything.
 *   ongoing  → everything (a-restock-is-edited-only-while-ongoing).
 *   arrived  → the LINES only — each line's count, total and note, and a new line may be added (with a note) but
 *              none removed (the-lines-stay-editable-until-accepted, lines-can-be-added-not-removed-while-arrived).
 *              The paying account, the invoice, the parcel and a STORED line's supplier are closed; a line added now
 *              may name its own (a-line-added-after-arrival-names-its-supplier).
 *   closed   → nothing: accepted, lost or cancelled — or not this team's restock to edit.
 */
export type FormMode = "create" | "ongoing" | "arrived" | "closed";

export function modeFor(request: RestockRequest, teamId: bigint): FormMode {
  // Only the RAISING team edits (the-warehouse-signs-and-accepts-the-team-does-the-rest). The warehouse can read the
  // restock, so its detail call succeeds — the form must not offer it fields the server will refuse.
  if (request.requestingTeamId !== teamId) return "closed";

  switch (request.status) {
    case RestockRequestStatus.ONGOING:
      return "ongoing";
    case RestockRequestStatus.ARRIVED:
      return "arrived";
    default:
      return "closed";
  }
}

/**
 * One editable line. The numbers are STRINGS while typed (an empty box is not 0); the identity is the product — a
 * restock lists each product once (a-product-appears-once-per-restock), and the picker cannot tick one twice.
 */
export interface LineDraft {
  /** The stored line's id; 0n for a line added in this edit. */
  itemId: bigint;
  productId: bigint;
  sku: string;
  name: string;
  /** How many were ordered (a-line-is-typed-as-its-total). */
  count: string;
  /** The line's TOTAL as the invoice prints it; the per-piece price is derived for display only. */
  total: string;
  /** Any team's supplier; 0n = not connected (a-line-connects-to-any-teams-supplier-from-a-popup). */
  supplierId: bigint;
  /** One of that supplier's stores; 0n = none (a-line-may-name-a-supplier-without-a-channel). */
  supplierChannelId: bigint;
  /**
   * The line takes the form's SUPPLIER FOR ALL PRODUCTS (one-supplier-for-all-in-two-steps) — a screen convenience,
   * never sent: the line still saves its own supplier and store. False once the line picks its own.
   */
  followsAll: boolean;
  /** The selling team's note on the line — "extra stock" (three-notes-one-writer-each). */
  note: string;
  /** Display only — the restock line stores no picture. */
  imageUrl: string;
  thumbnailUrl: string;
  /**
   * Was on the restock when it was loaded. While ARRIVED a stored line cannot be removed and its supplier cannot
   * change; a line added in this edit can be dropped again (it was never saved), must carry a note, and may name its
   * supplier (a-line-added-after-arrival-names-its-supplier).
   */
  stored: boolean;
}

export function lineFromPicked(p: PickedProduct): LineDraft {
  return {
    itemId: 0n,
    productId: p.id,
    sku: p.sku,
    name: p.name,
    count: "1",
    total: "",
    supplierId: 0n,
    supplierChannelId: 0n,
    followsAll: false,
    note: "",
    imageUrl: p.defaultImageUrl ?? "",
    thumbnailUrl: p.defaultImageThumbnailUrl ?? "",
    stored: false,
  };
}

export function lineFromItem(item: RestockRequestItem): LineDraft {
  return {
    itemId: item.id,
    productId: item.productId,
    sku: item.sku,
    name: item.name,
    count: String(item.count),
    total: String(item.total),
    supplierId: item.supplierId,
    supplierChannelId: item.supplierChannelId,
    followsAll: false,
    note: item.note,
    imageUrl: "",
    thumbnailUrl: "",
    stored: true,
  };
}

/** Whether the line's supplier may change — closed on a STORED line while the box is at the door. */
export function supplierOpen(mode: FormMode, line: LineDraft): boolean {
  return !(mode === "arrived" && line.stored);
}

/**
 * The supplier every open line already shares — what an edit opens with as its supplier for all products
 * (one-supplier-for-all-in-two-steps). Null below two open lines, or when any of them differs or names none.
 */
export function sharedSupplier(
  mode: FormMode,
  lines: LineDraft[],
): { supplierId: bigint; supplierChannelId: bigint } | null {
  const open = lines.filter((l) => supplierOpen(mode, l));
  const first = open[0];
  if (open.length < 2 || !first || first.supplierId === 0n) return null;

  const same = open.every((l) => l.supplierId === first.supplierId && l.supplierChannelId === first.supplierChannelId);

  return same ? { supplierId: first.supplierId, supplierChannelId: first.supplierChannelId } : null;
}

/** A count is a whole number of at least 1; anything else reads as 0, which no line may carry. */
export function toQty(raw: string): number {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(n) || n < 1) return 0;

  return n;
}

/** The line's money — the typed total; blank reads as 0, which the form no longer saves (the-count-and-total-are-required). */
export function lineMoney(line: LineDraft): number {
  return toRupiah(line.total);
}

/** What one piece cost, derived — total ÷ count, rounded only where it is shown; 0 while the count is not valid. */
export function perPiece(line: LineDraft): number {
  const qty = toQty(line.count);

  return qty > 0 ? lineMoney(line) / qty : 0;
}

/** A line added while the box is at the door must say why (lines-can-be-added-not-removed-while-arrived). */
export function needsNote(mode: FormMode, line: LineDraft): boolean {
  return mode === "arrived" && !line.stored && line.note.trim() === "";
}

/**
 * The restock's money as the selling team agreed to it: the goods plus the shipping it paid — and NEVER the courier's
 * charge at the door, which the warehouse paid later and is owed back as its own debt
 * (the-couriers-charge-stays-out-of-total). The form has no such field, and this is why.
 */
export function totals(lines: LineDraft[], shippingCost: string) {
  const goods = lines.reduce((sum, l) => sum + lineMoney(l), 0);
  const shipping = toRupiah(shippingCost);

  return { goods, shipping, total: goods + shipping };
}

/** What still stands between the form and Save — each an i18n key under `restock.form.missing`. */
export type MissingId =
  | "lines"
  | "supplier"
  | "count"
  | "total"
  | "newLineNote"
  | "warehouse"
  | "account"
  | "receipt";

/**
 * IN THE ORDER THE FORM IS CHECKED (owner: *"untuk urutan validasi restocknya mulai dari produk, gudang, rekening, resi"*,
 * *"di produk perlu cek semuanya punya supplier dulu"*, the-checks-run-products-warehouse-account-resi): the products —
 * there are some, every one names its supplier, every count is real, an added one says why — then the warehouse, the
 * paying account, the tracking number. The first entry is the one the line by Buat Restok names.
 *
 * ⚠ Stricter than the server: it takes a line with no supplier and a restock with no resi. A supplier closed by the
 * box's arrival, and the account and the resi closed with the parcel, are never asked for — they cannot be given.
 */
export function missingParts(args: {
  mode: FormMode;
  warehouseId: bigint;
  financeAccountId: bigint;
  receipt: string;
  lines: LineDraft[];
}): MissingId[] {
  const { mode, warehouseId, financeAccountId, receipt, lines } = args;
  const out: MissingId[] = [];

  if (lines.length === 0) out.push("lines");
  if (lines.some((l) => supplierOpen(mode, l) && l.supplierId === 0n)) out.push("supplier");
  if (lines.some((l) => toQty(l.count) < 1)) out.push("count");
  // A TOTAL ABOVE ZERO on every line (owner: *"jumlah dan total produk juga wajib"*, the-count-and-total-are-required) —
  // a blank total no longer passes as a free sample.
  if (lines.some((l) => lineMoney(l) <= 0)) out.push("total");
  if (lines.some((l) => needsNote(mode, l))) out.push("newLineNote");
  if (warehouseId === 0n) out.push("warehouse");
  // REQUIRED (a-restock-names-its-paying-account). While arrived it is closed, and was set when the restock was
  // raised, so it is not asked for again — nor is the resi, closed with it.
  if (financeAccountId === 0n && mode !== "arrived") out.push("account");
  if (receipt.trim() === "" && mode !== "arrived") out.push("receipt");

  return out;
}
