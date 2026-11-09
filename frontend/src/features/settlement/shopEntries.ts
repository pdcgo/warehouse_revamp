import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { settlementClient, settlementWriteClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { LAST_MONTH } from "../../components/datetime/DateRangePicker";
import type { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import {
  SettlementType,
  ShopEntryStatementReason,
  SourceType,
  type ShopSettlementEntry,
} from "../../gen/warehouse/settlement/v1/settlement_pb";
import { dateRangeCodec } from "../../lib/urlState";

// SHOP ENTRIES (the-shop-entries-page-is-accepted) — the settlement rows addressed to a SHOP and no order
// (an-entry-names-an-order-or-a-shop): a withdrawal, a system adjustment, a shop-level fee or ad charge, and a statement
// line whose ref found no order or several live orders. They fold into the report like an order's rows; this is the one
// screen that lists them. Never the sale or its cancel — the server refuses those without an order.
//
// Read by `SettlementService.ShopSettlementEntryList`; each row carries the statement it came from (the importer's
// line, asked by the server) and the row that reversed it. A row is REVERSED by the order ledger's own write
// (a-shop-entry-reverses-inline): SettlementPost of the opposite row, keyed `reverse-<id>`.

/** The page's route — under the settlement sub-menu's routes (`/settlement/*`). */
export const SHOP_ENTRIES_PATH = "/settlement/shop-entries";

/** The kinds a shop entry can be — every settlement type except the order's own sale and its cancel. */
export const SHOP_ENTRY_KINDS: SettlementType[] = [
  SettlementType.WITHDRAWAL,
  SettlementType.FUND,
  SettlementType.EXTERNAL_ADS_FEE,
  SettlementType.AFFILIATE_FEE,
  SettlementType.MARKETPLACE_ADJUSTMENT,
  SettlementType.SHIPMENT_ADJUSTMENT,
  SettlementType.LOGISTIC_REIMBURSEMENT,
  SettlementType.PLATFORM_REIMBURSEMENT,
  SettlementType.MARKETPLACE_PROGRAM,
  SettlementType.SYSTEM_ADJUSTMENT,
  SettlementType.OTHER,
];

/** Why an imported line went to the shop rather than to an order — the importer's own record of it. */
export type ShopEntryImportReason = "shop_line" | "no_order" | "several_orders";

/** The statement line an entry came from — the importer's line whose `settlement_log_id` is this entry. */
export interface ShopEntryImport {
  fileId: bigint;
  platform: Marketplace;
  /** The statement's own range, `yyyy-mm-dd`. */
  periodFrom: string;
  periodTo: string;
  /** The file's sheet and the platform's own words for the line — "Penarikan Dana", "Withdrawal". */
  sheet: string;
  description: string;
  /** The order ref the line carried, "" for a line that names none (a withdrawal, a shop fee). */
  orderRef: string;
  reason: ShopEntryImportReason;
  /** several_orders: every live order the ref found, so a person can place the money. */
  foundOrderIds: bigint[];
  /** Who uploaded the file. */
  uploadedBy: bigint;
  uploadedByName: string;
}

export interface ShopEntry {
  id: bigint;
  teamId: bigint;
  shopId: bigint;
  settlementType: SettlementType;
  sourceType: SourceType;
  /** Signed rupiah, exact as posted — positive is money toward us. */
  change: number;
  /** The day the platform says the money belongs to, `yyyy-mm-dd`. */
  occurredOn: string;
  /** The day we learned it — what the window filters on (posted-on-buckets-the-report). */
  postedOn: string;
  note: string;
  /** Who posted it (actor-id-is-the-pic), and their name as the server resolved it ("" when unknown). */
  actorId: bigint;
  actorName: string;
  /** The row this one undoes, or 0n. */
  reversesId: bigint;
  /** The row that undid this one, or 0n — a row is reversed once. */
  reversedById: bigint;
  import?: ShopEntryImport;
}

export interface ShopEntriesTotals {
  /** Entries in the whole filtered set — never just the page. */
  count: number;
  /** Σ change of every entry but withdrawals — the report's Received, for these rows. */
  received: number;
  /** −Σ change of the withdrawals — positive, the report's Withdrawn. */
  withdrawn: number;
}

export interface ShopEntriesAnswer {
  entries: ShopEntry[];
  hasNext: boolean;
  totals: ShopEntriesTotals;
}

const REASON: Record<ShopEntryStatementReason, ShopEntryImportReason> = {
  [ShopEntryStatementReason.UNSPECIFIED]: "shop_line",
  [ShopEntryStatementReason.SHOP_LINE]: "shop_line",
  [ShopEntryStatementReason.NO_ORDER]: "no_order",
  [ShopEntryStatementReason.SEVERAL_ORDERS]: "several_orders",
};

/** One wire row → the page's row. */
export function shopEntryFromWire(row: ShopSettlementEntry): ShopEntry | undefined {
  const e = row.entry;
  if (!e) return undefined;
  const s = row.statement;

  return {
    id: e.id,
    teamId: e.teamId,
    shopId: e.shopId,
    settlementType: e.settlementType,
    sourceType: e.sourceType,
    change: e.change,
    occurredOn: e.occurredOn,
    postedOn: e.postedOn,
    note: e.note,
    actorId: e.actorId,
    actorName: e.actorName,
    reversesId: e.reversesId,
    reversedById: row.reversedById,
    import: s
      ? {
          fileId: s.uploadedFileId,
          platform: s.platform,
          periodFrom: s.periodFrom,
          periodTo: s.periodTo,
          sheet: s.sheet,
          description: s.description,
          orderRef: s.orderRef,
          reason: REASON[s.reason] ?? "shop_line",
          foundOrderIds: s.foundOrderIds,
          uploadedBy: s.uploadedByUserId,
          uploadedByName: s.uploadedByName,
        }
      : undefined,
  };
}

/** The list — the server filters, pages and totals (`ShopSettlementEntryList`). */
export function useShopSettlementEntries(args: {
  teamId: bigint | undefined;
  /** 0n = every shop. */
  shopId: bigint;
  /** undefined = every kind. */
  kind?: SettlementType;
  /** Inclusive Jakarta days, `yyyy-mm-dd`; "" is an open end. */
  from: string;
  to: string;
  page: number;
  pageSize: number;
}) {
  const { teamId, shopId, kind, from, to, page, pageSize } = args;

  return useQuery({
    // Under `settlement`, so a reversal posted here (or on an order's ledger) refreshes it.
    queryKey: key.settlement(teamId, {
      shopEntries: 1,
      shop: shopId.toString(),
      kind: kind ?? 0,
      from,
      to,
      page,
      pageSize,
    }),
    ...listQuery,
    enabled: teamId !== undefined,
    queryFn: async (): Promise<ShopEntriesAnswer> => {
      const res = await settlementClient.shopSettlementEntryList({
        teamId: teamId!,
        filter: {
          shopId,
          settlementTypes: kind !== undefined ? [kind] : [],
          postedFrom: from,
          postedTo: to,
        },
        page: { page, limit: pageSize },
      });

      const byId = res.items[0]?.d.case === "entry" ? res.items[0].d.value.mapData : {};
      const entries = res.ids
        .map((id) => byId[id.toString()])
        .filter((row): row is ShopSettlementEntry => row !== undefined)
        .map(shopEntryFromWire)
        .filter((row): row is ShopEntry => row !== undefined);
      const info = res.pageInfo;

      return {
        entries,
        hasNext: info ? info.currentPage < info.totalPage : false,
        totals: {
          count: Number(info?.totalItems ?? 0n),
          received: res.totalReceived,
          withdrawn: res.totalWithdrawn,
        },
      };
    },
  });
}

/**
 * REVERSE A SHOP ENTRY (a-shop-entry-reverses-inline) — the order ledger's own write: SettlementPost of the exact
 * opposite, same type, pointing back at the row, keyed `reverse-<id>` as the order's ledger keys it. The server refuses
 * a row already reversed. Posted under the ROW's team: the root team reads every team's rows.
 */
export function useReverseShopEntry(readerTeamId: bigint | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entry: ShopEntry) =>
      settlementWriteClient.settlementPost({
        teamId: entry.teamId,
        orderId: 0n,
        shopId: entry.shopId,
        uniqueId: `reverse-${entry.id}`,
        settlementType: entry.settlementType,
        sourceType: SourceType.MANUAL,
        change: -entry.change,
        occurredOn: entry.occurredOn,
        reversesId: entry.id,
        note: `reverses #${entry.id}`,
      }),
    // Settled either way: a refusal ("already reversed") means the list is stale, so it is read again too.
    onSettled: () => queryClient.invalidateQueries({ queryKey: key.settlement(readerTeamId) }),
  });
}

/**
 * The link the report's By shop row opens: the shop and the report's own window, so the entries read are the ones the
 * report folded. A default range is left out, as every list's URL leaves its defaults out (a-lists-filters-live-in-the-url).
 */
export function shopEntriesLink(shopId: bigint, range: DateRange): string {
  const params = new URLSearchParams();
  if (shopId > 0n) params.set("shop", shopId.toString());
  const encoded = dateRangeCodec.encode(range);
  if (encoded !== dateRangeCodec.encode(LAST_MONTH)) params.set("range", encoded);
  const search = params.toString();

  return search ? `${SHOP_ENTRIES_PATH}?${search}` : SHOP_ENTRIES_PATH;
}

/** The wire source, as the ledger's badge names it (the-source-is-a-badge). */
export function sourceKey(source: SourceType): "importer" | "manual" | "order" {
  switch (source) {
    case SourceType.IMPORTER:
      return "importer";
    case SourceType.ORDER:
      return "order";
    default:
      return "manual";
  }
}
