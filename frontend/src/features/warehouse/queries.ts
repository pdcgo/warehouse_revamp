import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code, ConnectError } from "@connectrpc/connect";

import { warehouseFeeClient } from "../../api/clients";
import { key } from "../../api/queryClient";

/** What the order form is told about the fee for the order on screen — a price, or the warehouse's refusal. */
export interface WarehouseFeeQuote {
  warehouseId: bigint;
  /** The fee, rounded to whole rupiah for the form's bigint arithmetic. `null` when refused. */
  fee: bigint | null;
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
  /** Σ quantity × HPP — the order's goods cost, the basis the fee is priced on (the-fee-is-priced-on-goods-cost). */
  goodsCost: bigint;
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
          orderTotal: Number(goodsCost),
        });

        return { warehouseId, fee: BigInt(Math.round(res.calculatedWarehouseFee)), refusal: null };
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
