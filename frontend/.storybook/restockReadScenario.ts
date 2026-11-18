// WHAT THE RESTOCK READS WERE ASKED, in Storybook — recorded by restockStub.ts and reset with it:
//   byIdsCalls  each RestockRequestByIds call's ids, in order (Cetak Label reads every restock on the print in ONE call,
//               the-labels-mark-their-one-by-one-read)
//   codWindows  each RestockCodPaidStat call's window (the warehouse list's COD card asks this Jakarta month,
//               the-warehouse-sees-the-cod-it-paid)
//   sellingStatCalls  each RestockSellingStat call's team and filter (the selling list's statistics are read only once
//               opened, then follow every filter — the-statistics-are-shut-and-read-when-opened)
//
// ⚠ ITS OWN MODULE (as sessionScenario.ts): a story imports it, and importing stubTransport.ts would pull the whole stub
// into `npm run typecheck`.

export const restockReadScenario: {
  byIdsCalls: bigint[][];
  codWindows: { teamId: bigint; fromUnix: bigint; toUnix: bigint }[];
  sellingStatCalls: { teamId: bigint; filter: { q?: string; shipmentId?: bigint; warehouseId?: bigint } | undefined }[];
} = { byIdsCalls: [], codWindows: [], sellingStatCalls: [] };

export function resetRestockReadScenario() {
  restockReadScenario.byIdsCalls = [];
  restockReadScenario.codWindows = [];
  restockReadScenario.sellingStatCalls = [];
}
