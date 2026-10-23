// warehouse_service's WarehouseFeeService as Storybook's stub — what a warehouse charges per order
// (warehouse-prices-balance-records), one rate per warehouse:
//   fee = clamp(goods_cost × fee_percent / 100, min_fee, max_fee), an empty max_fee meaning no cap.
//
// Seeded so both states can be looked at: Gudang Pusat (11) charges 2.5%, floor 2 000, cap 20 000; Gudang Cabang (14) has
// set nothing. It refuses what the server refuses — a floor above the cap — and a calculation at a warehouse with no rate.
//
// WRITEABLE: a save is read back on the next detail. preview.tsx resets it in its `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import type { WarehouseFeeService } from "../src/gen/warehouse/warehouse/v1/warehouse_fee_pb";

interface Row {
  feePercent: number;
  minFee: number;
  maxFee?: number;
  updatedAtUnix: bigint;
}

const SEEDED_AT = 1_790_000_000n;

const seed = (): Map<bigint, Row> => new Map([[11n, { feePercent: 2.5, minFee: 2_000, maxFee: 20_000, updatedAtUnix: SEEDED_AT }]]);

let table = seed();

export function resetWarehouseFeeStub() {
  table = seed();
}

/** The warehouse's saved fee, undefined when none — what a story asserts a save wrote. */
export function warehouseFeeOf(warehouseId: bigint): Row | undefined {
  return table.get(warehouseId);
}

export const warehouseFeeService: Partial<ServiceImpl<typeof WarehouseFeeService>> = {
  warehouseFeeDetail: (req) => {
    const row = table.get(req.teamId);

    return { fee: row ? { warehouseId: req.teamId, ...row } : undefined };
  },
  warehouseFeeSet: (req) => {
    if (req.maxFee !== undefined && req.minFee > req.maxFee) {
      throw new ConnectError("the floor (min_fee) cannot be above the cap (max_fee)", Code.InvalidArgument);
    }

    const row: Row = {
      feePercent: req.feePercent,
      minFee: req.minFee,
      maxFee: req.maxFee,
      updatedAtUnix: BigInt(Math.floor(Date.now() / 1000)),
    };
    table.set(req.teamId, row);

    return { fee: { warehouseId: req.teamId, ...row } };
  },
  warehouseFeeCalculate: (req) => {
    const row = table.get(req.warehouseId);
    if (!row) {
      throw new ConnectError(`warehouse ${req.warehouseId} has not set its fee`, Code.FailedPrecondition);
    }

    let fee = Math.max((req.orderTotal * row.feePercent) / 100, row.minFee);
    if (row.maxFee !== undefined) fee = Math.min(fee, row.maxFee);

    return {
      warehouseId: req.warehouseId,
      orderTotal: req.orderTotal,
      feePercent: row.feePercent,
      minFee: row.minFee,
      maxFee: row.maxFee,
      calculatedWarehouseFee: fee,
    };
  },
};
