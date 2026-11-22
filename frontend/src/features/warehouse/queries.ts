import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code, ConnectError } from "@connectrpc/connect";

import { warehouseFeeClient, warehouseInfoClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import type { WarehouseInfo } from "../../gen/warehouse/warehouse/v1/warehouse_info_pb";

/** What the order form is told about the fee for the order on screen — a price, or the warehouse's refusal. */
export interface WarehouseFeeQuote {
  warehouseId: bigint;
  /** The fee, exact as the warehouse prices it — never rounded. `null` when refused. */
  fee: number | null;
  /** "Gudang A has not set its fee" — the server's own sentence (a-warehouse-with-no-rate-takes-no-orders). */
  refusal: string | null;
}

/**
 * THE FEE FOR THE ORDER BEING TYPED — WarehouseFeeCalculate on the chosen warehouse and the goods' cost, the very
 * call order create makes before it freezes the fee (the-fee-is-priced-one-warehouse-at-a-time). So the figure on
 * the form is the figure the order will keep, not a guess beside it.
 *
 * ⚠ A REFUSAL IS AN ANSWER, NOT AN ERROR. A warehouse that never set its fee takes no orders, and the form shows the
 * server's sentence and keeps Save off — so `FailedPrecondition` is returned as `refusal`, while anything else
 * (the server unreachable) stays a query error.
 *
 * ⚠ THE PREVIOUS PRICE STAYS ON SCREEN while a changed quantity re-prices it — the same question asked of a new basis —
 * but never across warehouses, where the previous figure would be another building's.
 */
export function useWarehouseFeeQuote(args: {
  teamId: bigint | undefined;
  warehouseId: bigint;
  /** Σ quantity × HPP — the order's goods cost, exact, the basis the fee is priced on (the-fee-is-priced-on-goods-cost). */
  goodsCost: number;
}) {
  const { teamId, warehouseId, goodsCost } = args;

  return useQuery({
    queryKey: key.warehouseFee(teamId, { quote: warehouseId.toString(), goodsCost: goodsCost.toString() }),
    enabled: teamId !== undefined && teamId > 0n && warehouseId > 0n,
    placeholderData: (previous: WarehouseFeeQuote | undefined) =>
      previous?.warehouseId === warehouseId ? previous : undefined,
    queryFn: async (): Promise<WarehouseFeeQuote> => {
      try {
        const res = await warehouseFeeClient.warehouseFeeCalculate({
          teamId: teamId!,
          warehouseId,
          orderTotal: goodsCost,
        });

        // EXACT, as the order will freeze it (the-backend-never-rounds-money) — 2,5% of Rp 12.666,99 is Rp 316,67475.
        return { warehouseId, fee: res.calculatedWarehouseFee, refusal: null };
      } catch (err) {
        const connectErr = ConnectError.from(err);
        if (connectErr.code === Code.FailedPrecondition) {
          return { warehouseId, fee: null, refusal: connectErr.rawMessage };
        }

        throw err;
      }
    },
  });
}

// WHAT A WAREHOUSE CHARGES PER ORDER (warehouse-prices-balance-records) — warehouse_service's fee configuration.
//   fee = clamp(goods_cost × fee_percent / 100, min_fee, max_fee), an empty max_fee meaning no cap
//   (the-fee-has-a-floor-and-a-cap, an-empty-cap-means-no-cap).

/** The warehouse's fee, or `null` when it never set one — the state that takes no orders, a normal answer. */
export function useWarehouseFee(args: { teamId: bigint | undefined }) {
  const { teamId } = args;

  return useQuery({
    queryKey: key.warehouseFee(teamId),
    enabled: teamId !== undefined && teamId > 0n,
    queryFn: async () => {
      const res = await warehouseFeeClient.warehouseFeeDetail({ teamId: teamId! });

      return res.fee ?? null;
    },
  });
}

/** Set — or replace — the warehouse's fee. `maxFee` undefined = no cap; the server refuses a cap of 0. */
export function useSetWarehouseFee() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { teamId: bigint; feePercent: number; minFee: number; maxFee?: number }) =>
      (await warehouseFeeClient.warehouseFeeSet(vars)).fee,
    onSuccess: () => client.invalidateQueries({ queryKey: ["warehouseFee"] }),
  });
}

/**
 * WHETHER A WAREHOUSE RECEIVES ORDERS NOW (a-closed-day-warns-and-never-refuses) — and if not, its next opening and, for
 * a one-off closure, why. It only MARKS: the order is created whatever this says. Read fresh, like every read here.
 */
export function useWarehouseReceiving(warehouseId: bigint) {
  return useQuery({
    // Under the warehouse's own `warehouseInfo` prefix: a closure added or removed there re-reads this (ClosuresEditor).
    queryKey: key.warehouseInfo(warehouseId, { receiving: true }),
    enabled: warehouseId > 0n,
    queryFn: async () => {
      const res = await warehouseInfoClient.warehouseReceivingStatus({ warehouseIds: [warehouseId] });

      return res.states[warehouseId.toString()] ?? null;
    },
  });
}

/**
 * A WAREHOUSE'S PROFILE — its weekly hours, its location and its closures still to come (WarehouseInfoDetail), `null`
 * when it has none. ONE cache entry per warehouse for every screen that shows it: the team page's Gudang section, and
 * the edit page — its form AND its closures list, which used to read it twice a load (the speed audit's duplicate,
 * audits/frontend/warehouse-edit.md). A by-id read on the plain always-fresh default: another warehouse is another
 * subject, never drawn under this one's address.
 *
 * `enabled` may be a FUNCTION — the edit page keeps the read still while its own save runs (pages/warehouse-edit).
 */
export function useWarehouseInfo(args: { warehouseId: bigint; enabled?: boolean | (() => boolean) }) {
  const { warehouseId } = args;
  const enabled = args.enabled ?? true;

  return useQuery({
    queryKey: key.warehouseInfo(warehouseId),
    enabled: () => warehouseId > 0n && (typeof enabled === "function" ? enabled() : enabled),
    queryFn: async (): Promise<WarehouseInfo | null> =>
      (await warehouseInfoClient.warehouseInfoDetail({ teamId: warehouseId })).info ?? null,
  });
}

/** After a warehouse's profile changed (a closure, its hours): its profile and its receiving state, read again. */
export function useInvalidateWarehouseInfo() {
  const client = useQueryClient();

  return (warehouseId: bigint) => client.invalidateQueries({ queryKey: key.warehouseInfo(warehouseId) });
}
