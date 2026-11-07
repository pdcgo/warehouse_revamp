// SHOP ENTRIES' STUB (the-shop-entries-page-is-accepted) — `SettlementService.ShopSettlementEntryList` and the reverse
// it offers (`SettlementWriteService.SettlementPost` of a shop row's opposite, a-shop-entry-reverses-inline), over a
// writeable book of Toko Melati's shop-addressed rows, with the server's rules: the team's rows only, the filters before
// the page, the whole set's totals, newest learned first; a reversal must be the exact opposite of a row of the same
// shop, and a row is reversed ONCE (a second key is refused, the same key answers the first).
//
// The book is in JAKARTA DAYS AGO, never fixed dates, so the default window (the last month) always holds the same rows.
// ⚠ Row 7101 — a 200.000 withdrawal at Melati Official two days ago — IS the report book's own withdrawal
// (fixtures.ts settlementBook), so the report's Withdrawn for that shop and this list's Withdrawn agree.
//
// In the last month: 8 entries — received +192.765,5 (a fraction, shown to its 3 places), withdrawn 1.700.000.

import { Code, ConnectError } from "@connectrpc/connect";

import { jakartaWindowOf } from "../src/features/settlement/window";
import type { ShopEntry, ShopEntryImport } from "../src/features/settlement/shopEntries";
import { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";
import {
  SettlementType,
  ShopEntryStatementReason,
  SourceType,
  type SettlementPostRequest,
  type ShopSettlementEntryListRequest,
} from "../src/gen/warehouse/settlement/v1/settlement_pb";

/** `days` ago as a JAKARTA `yyyy-mm-dd` — the calendar the list's window resolves on. */
export const wibDayKey = (days: number): string => jakartaWindowOf({ kind: "relative", days: days + 1 }).from;

const NAMES: Record<string, string> = { "61": "Dewi Lestari", "62": "Budi Santoso", "64": "Rina Wijaya" };

// The statements the imported rows came from — Melati Official's Shopee and Melati TikTok's.
const shopee = (over: Partial<ShopEntryImport>): ShopEntryImport => ({
  fileId: 905n,
  platform: Marketplace.SHOPEE,
  periodFrom: wibDayKey(3),
  periodTo: wibDayKey(2),
  sheet: "Rincian Transaksi",
  description: "",
  orderRef: "",
  reason: "shop_line",
  foundOrderIds: [],
  uploadedBy: 62n,
  uploadedByName: NAMES["62"]!,
  ...over,
});
const tiktok = (over: Partial<ShopEntryImport>): ShopEntryImport => ({
  fileId: 907n,
  platform: Marketplace.TIKTOK,
  periodFrom: wibDayKey(8),
  periodTo: wibDayKey(7),
  sheet: "Order details",
  description: "",
  orderRef: "",
  reason: "shop_line",
  foundOrderIds: [],
  uploadedBy: 61n,
  uploadedByName: NAMES["61"]!,
  ...over,
});

const entry = (over: Partial<ShopEntry> & Pick<ShopEntry, "id" | "shopId" | "settlementType" | "change">): ShopEntry => {
  const actorId = over.actorId ?? 62n;

  return {
    teamId: 12n,
    sourceType: SourceType.IMPORTER,
    occurredOn: over.postedOn ?? wibDayKey(1),
    postedOn: wibDayKey(1),
    note: "",
    actorId,
    actorName: NAMES[actorId.toString()] ?? "",
    reversesId: 0n,
    reversedById: 0n,
    ...over,
  };
};

/** The book every story starts from. */
export function shopEntriesBook(): ShopEntry[] {
  return [
    entry({
      id: 7101n, shopId: 21n, settlementType: SettlementType.WITHDRAWAL, change: -200_000, postedOn: wibDayKey(2),
      import: shopee({ sheet: "Penarikan Dana", description: "Penarikan dana ke rekening BCA" }),
    }),
    entry({
      id: 7102n, shopId: 21n, settlementType: SettlementType.FUND, change: 185_000, postedOn: wibDayKey(2), occurredOn: wibDayKey(6),
      import: shopee({ orderRef: "241101ABCD", reason: "no_order", description: "Penghasilan dari pesanan 241101ABCD" }),
    }),
    entry({
      id: 7103n, shopId: 21n, settlementType: SettlementType.FUND, change: 64_000, postedOn: wibDayKey(2), occurredOn: wibDayKey(5),
      import: shopee({ orderRef: "241102DUPE", reason: "several_orders", foundOrderIds: [5001n, 5002n] }),
    }),
    entry({
      id: 7104n, shopId: 25n, settlementType: SettlementType.EXTERNAL_ADS_FEE, change: -75_000, postedOn: wibDayKey(7), actorId: 61n,
      import: tiktok({ sheet: "Ads", description: "TikTok Ads — top up saldo iklan" }),
    }),
    entry({
      id: 7105n, shopId: 25n, settlementType: SettlementType.OTHER, change: -1_234.5, postedOn: wibDayKey(7), actorId: 61n,
      import: tiktok({ description: "Biaya layanan transaksi" }),
    }),
    entry({
      id: 7106n, shopId: 22n, settlementType: SettlementType.SYSTEM_ADJUSTMENT, change: 12_000, postedOn: wibDayKey(9),
      sourceType: SourceType.MANUAL, actorId: 64n, note: "Perbaikan laporan — ongkir 3 pesanan tercatat dua kali",
    }),
    entry({
      id: 7107n, shopId: 21n, settlementType: SettlementType.LOGISTIC_REIMBURSEMENT, change: 8_000, postedOn: wibDayKey(12), occurredOn: wibDayKey(14),
      import: shopee({ fileId: 906n, periodFrom: wibDayKey(14), periodTo: wibDayKey(12), orderRef: "241020WXYZ", reason: "no_order" }),
    }),
    entry({
      id: 7108n, shopId: 21n, settlementType: SettlementType.WITHDRAWAL, change: -1_500_000, postedOn: wibDayKey(12),
      import: shopee({ fileId: 906n, periodFrom: wibDayKey(14), periodTo: wibDayKey(12), sheet: "Penarikan Dana", description: "Penarikan dana ke rekening BCA" }),
    }),
    // Outside the last month — read only with a longer window.
    entry({
      id: 7109n, shopId: 22n, settlementType: SettlementType.MARKETPLACE_ADJUSTMENT, change: -5_000, postedOn: wibDayKey(45),
      sourceType: SourceType.MANUAL, actorId: 64n, note: "Denda keterlambatan kirim",
    }),
  ];
}

/** A book of `count` withdrawals, one a day — for the growing pager. */
export function longShopEntriesBook(count: number): ShopEntry[] {
  return Array.from({ length: count }, (_, i) =>
    entry({
      id: BigInt(8000 + i), shopId: 21n, settlementType: SettlementType.WITHDRAWAL, change: -(10_000 + i * 1_000),
      postedOn: wibDayKey(i % 28), import: shopee({ sheet: "Penarikan Dana", description: `Penarikan dana #${i + 1}` }),
    }),
  );
}

let book: ShopEntry[] = shopEntriesBook();
let nextId = 9000n;
// The reversals' keys → their rows: the same key again answers the first (`created: false`), as the server's key does.
const keys = new Map<string, bigint>();

/** The list requests the stub received, newest last — a story asserts the filters it sent. */
export const shopEntriesCalls: ShopSettlementEntryListRequest[] = [];
/** The reversals the stub received, newest last. */
export const shopEntryPosts: SettlementPostRequest[] = [];

/** A story's own book (Empty, the pager) — set in its `beforeEach`; preview's reset puts the default back. */
export function withShopEntriesBook(rows: ShopEntry[]) {
  book = rows.map((r) => ({ ...r }));
}

export function resetShopEntries() {
  book = shopEntriesBook();
  nextId = 9000n;
  keys.clear();
  shopEntriesCalls.splice(0);
  shopEntryPosts.splice(0);
}

const REASON = {
  shop_line: ShopEntryStatementReason.SHOP_LINE,
  no_order: ShopEntryStatementReason.NO_ORDER,
  several_orders: ShopEntryStatementReason.SEVERAL_ORDERS,
} as const;

function toWire(e: ShopEntry) {
  return {
    entry: {
      id: e.id,
      uniqueId: `stub-${e.id}`,
      orderId: 0n,
      shopId: e.shopId,
      teamId: e.teamId,
      actorId: e.actorId,
      sourceType: e.sourceType,
      settlementType: e.settlementType,
      change: e.change,
      balance: 0,
      occurredOn: e.occurredOn,
      postedOn: e.postedOn,
      reversesId: e.reversesId,
      note: e.note,
      actorName: e.actorName,
    },
    reversedById: e.reversedById,
    statement: e.import
      ? {
          uploadedFileId: e.import.fileId,
          platform: e.import.platform,
          periodFrom: e.import.periodFrom,
          periodTo: e.import.periodTo,
          sheet: e.import.sheet,
          description: e.import.description,
          orderRef: e.import.orderRef,
          reason: REASON[e.import.reason],
          foundOrderIds: e.import.foundOrderIds,
          uploadedByUserId: e.import.uploadedBy,
          uploadedByName: e.import.uploadedByName,
        }
      : undefined,
  };
}

/** ShopSettlementEntryList — the server's filter (team, shop, kind, learned day), newest first, the whole set's totals. */
export function shopSettlementEntryList(req: ShopSettlementEntryListRequest) {
  shopEntriesCalls.push(req);
  const f = req.filter;
  const kinds = f?.settlementTypes ?? [];
  const from = f?.postedFrom ?? "";
  const to = f?.postedTo ?? "";
  const matching = book
    .filter((e) => e.teamId === req.teamId)
    .filter((e) => !f?.shopId || e.shopId === f.shopId)
    .filter((e) => kinds.length === 0 || kinds.includes(e.settlementType))
    .filter((e) => (from === "" || e.postedOn >= from) && (to === "" || e.postedOn <= to))
    .sort((a, b) => (a.postedOn === b.postedOn ? Number(b.id - a.id) : a.postedOn < b.postedOn ? 1 : -1));

  const page = req.page?.page ?? 1;
  const limit = req.page?.limit ?? 20;
  const start = (page - 1) * limit;
  const rows = matching.slice(start, start + limit);
  const withdrawals = matching.filter((e) => e.settlementType === SettlementType.WITHDRAWAL);

  return {
    items: [{ d: { case: "entry" as const, value: { mapData: Object.fromEntries(rows.map((e) => [e.id.toString(), toWire(e)])) } } }],
    ids: rows.map((e) => e.id),
    pageInfo: { currentPage: page, totalPage: Math.ceil(matching.length / limit), totalItems: BigInt(matching.length) },
    totalReceived: matching.filter((e) => e.settlementType !== SettlementType.WITHDRAWAL).reduce((sum, e) => sum + e.change, 0),
    totalWithdrawn: -withdrawals.reduce((sum, e) => sum + e.change, 0),
  };
}

/**
 * SettlementPost, for a SHOP row's reversal — the only post the stories make on this book. An order row, or a post that
 * reverses nothing, is not this stub's: it answers Unimplemented, as the transport did before.
 */
export function shopEntrySettlementPost(req: SettlementPostRequest) {
  if (req.orderId !== 0n || req.reversesId === 0n) {
    throw new ConnectError("the stub posts only a shop entry's reversal", Code.Unimplemented);
  }
  shopEntryPosts.push(req);

  const same = book.find((e) => e.id === keys.get(req.uniqueId));
  if (same) return { entry: toWire(same).entry, created: false };

  const target = book.find((e) => e.id === req.reversesId && e.shopId === req.shopId && e.teamId === req.teamId);
  if (!target) throw new ConnectError("reverses_id names no entry on this order", Code.InvalidArgument);
  if (target.settlementType !== req.settlementType || Math.abs(target.change + req.change) > 0.00005) {
    throw new ConnectError("a reversal must carry the reversed entry's type and the opposite amount", Code.InvalidArgument);
  }
  if (target.reversedById !== 0n) throw new ConnectError("this entry is already reversed", Code.FailedPrecondition);

  const id = nextId++;
  const reversal: ShopEntry = {
    ...target,
    id,
    sourceType: SourceType.MANUAL,
    change: req.change,
    occurredOn: req.occurredOn,
    postedOn: wibDayKey(0),
    note: req.note,
    actorId: 64n,
    actorName: NAMES["64"]!,
    reversesId: target.id,
    reversedById: 0n,
    import: undefined,
  };
  target.reversedById = id;
  book.push(reversal);
  keys.set(req.uniqueId, id);

  return { entry: toWire(reversal).entry, created: true };
}

/** Marks a row reversed already — for the story that shows the Reversed state on load. */
export function reverseShopEntryForStory(id: bigint) {
  const target = book.find((e) => e.id === id);
  if (!target) throw new Error(`no shop entry ${id}`);
  shopEntrySettlementPost({
    teamId: target.teamId,
    orderId: 0n,
    shopId: target.shopId,
    uniqueId: `reverse-${id}`,
    settlementType: target.settlementType,
    sourceType: SourceType.MANUAL,
    change: -target.change,
    occurredOn: target.occurredOn,
    reversesId: id,
    note: `reverses #${id}`,
  } as SettlementPostRequest);
}
