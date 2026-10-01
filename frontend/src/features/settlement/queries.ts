import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settlementClient, settlementWriteClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import type { OrderSettlement, SettlementType, SourceType } from "../../pages/order-settlement/model";
import {
  entryFromWire,
  settlementFromWire,
  settlementRowData,
  settlementsFromList,
  wireSettlementType,
} from "./adapt";
import {
  OrderSettlementSort,
  SourceType as WireSourceType,
} from "../../gen/warehouse/settlement/v1/settlement_pb";
import { CommonSortType } from "../../gen/warehouse/common/v1/list_pb";

// The MARKETPLACE payout ledger's reads and its one write.
//
// ⚠ Not `features/liability`, which is what teams owe each other. Two ledgers, two services, and the
// only thing they share is that both are order-aware — this one is allowed to never balance.

export function useOrderSettlements(args: {
  teamId: bigint | undefined;
  shopId?: bigint;
  q?: string;
  page: number;
  pageSize: number;
}) {
  const { teamId, shopId, q, page, pageSize } = args;

  return useQuery({
    // `listQuery` — a key change here REFINES the same question (page 2, this shop, this search), so
    // the previous rows stay on screen while the next ones load.
    ...listQuery,
    queryKey: key.settlement(teamId, { page, pageSize, shopId: String(shopId ?? ""), q: q ?? "" }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await settlementClient.orderSettlementList({
        teamId: teamId!,
        filter: { shopId: shopId ?? 0n, q: q ?? "" },
        dataRequest: settlementRowData(),
        page: { page, limit: pageSize },
        // Worst loss first — the question the screen exists to answer.
        sort: { sort: OrderSettlementSort.LOSS, sortType: CommonSortType.ASC },
      });

      return {
        settlements: settlementsFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
        totalInitialTotal: res.totalInitialTotal,
        totalLastBalance: res.totalLastBalance,
      };
    },
  });
}

/**
 * One order's account and its whole log.
 *
 * `known` carries what settlement cannot know — the marketplace reference, the names, the cogs. The
 * caller is the order detail page, which already holds them.
 */
export function useOrderSettlement(args: {
  teamId: bigint | undefined;
  orderId: bigint | undefined;
  known?: Partial<Pick<OrderSettlement, "orderRef" | "shopName" | "teamName" | "cogs">>;
}) {
  const { teamId, orderId, known } = args;

  return useQuery({
    queryKey: key.settlement(teamId, { orderId: String(orderId ?? "") }),
    enabled: teamId !== undefined && orderId !== undefined,
    queryFn: async () => {
      const res = await settlementClient.orderSettlementDetail({
        teamId: teamId!,
        orderId: orderId!,
      });

      const entries = res.entries.map(entryFromWire);

      return res.settlement
        ? settlementFromWire(res.settlement, known, entries)
        : undefined;
    },
    // ⚠ An order that has never been settled is a 404, and that is a REAL answer rather than a
    // failure — the screen says "not settled yet" instead of showing an error.
    retry: false,
  });
}

/**
 * Append one row by hand.
 *
 * ⚠ `uniqueId` is the CALLER's, and settlement invents nothing. A person's row is keyed by the moment
 * they submitted, which is what makes a double-submit of the same form idempotent while two genuinely
 * separate entries of the same amount stay two rows.
 */
export function usePostSettlementEntry(teamId: bigint | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      orderId: bigint;
      shopId: bigint;
      settlementType: SettlementType;
      sourceType: Extract<SourceType, "manual">;
      change: bigint;
      occurredOn: string;
      uniqueId: string;
      reversesId?: bigint;
      note?: string;
    }) => {
      const res = await settlementWriteClient.settlementPost({
        teamId: teamId!,
        orderId: input.orderId,
        shopId: input.shopId,
        uniqueId: input.uniqueId,
        settlementType: wireSettlementType[input.settlementType],
        sourceType: WireSourceType.MANUAL,
        change: input.change,
        occurredOn: input.occurredOn,
        reversesId: input.reversesId ?? 0n,
        note: input.note ?? "",
      });

      return res;
    },
    onSuccess: () => {
      // Both the panel and the list move — the account's balance changed and its rank with it.
      queryClient.invalidateQueries({ queryKey: key.settlement(teamId) });
    },
  });
}
