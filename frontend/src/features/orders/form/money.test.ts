import { describe, expect, it } from "vitest";

import { formatRupiah } from "../../../lib/money";
import type { Costs, LineDraft } from "../lines";
import { creditRows, goodsCostOf, invoiceRows } from "./money";

// THE ORDER FORM PREVIEWS THE EXACT FIGURES THE SERVER STORES (the-backend-never-rounds-money). The take prices each
// line exactly and selling freezes `goods_cost` as the exact SUM of the lines; the ledger posts an owner's charge and
// the warehouse fee the same way. Nothing here rounds — only the formatter does, for the screen (up to 3 decimals,
// a-fraction-of-a-rupiah-shows-three-decimals).

const SELLER = 1n;
const OWNER = 7n;
const WAREHOUSE = 3n;

function line(productId: bigint, quantity: number): LineDraft {
  return { productId, productCode: `P${productId}`, name: "", imageUrl: "", thumbnailUrl: "", quantity: String(quantity) };
}

// Three products whose draws each end in ,4 — the preview keeps every fraction.
const costs: Costs = new Map([
  ["11", { quantity: 1n, available: 1n, total: 10_000.4, unitCost: 10_000.4, batches: [] }],
  ["12", { quantity: 1n, available: 1n, total: 20_000.4, unitCost: 20_000.4, batches: [] }],
  ["13", { quantity: 1n, available: 1n, total: 30_000.4, unitCost: 30_000.4, batches: [] }],
]);
const lines = [line(11n, 1), line(12n, 1), line(13n, 1)];

describe("the order form's goods cost", () => {
  it("is the exact sum of the lines — 60.001,2, never rounded", () => {
    const goods = goodsCostOf({ lines, owners: undefined, costs, teamId: SELLER });
    expect(goods).toBeCloseTo(60_001.2, 6);
    expect(formatRupiah(goods)).toBe("Rp 60.001,2");
  });

  it("adds a borrowed line's markup exactly", () => {
    // 10.000,4 at 2,5% is 10.250,41; the own lines add 50.000,8 — 60.251,21 exactly.
    const owners = new Map([["11", { teamId: OWNER, crossMarkupBps: 250 }]]);
    expect(goodsCostOf({ lines, owners, costs, teamId: SELLER })).toBeCloseTo(60_251.21, 6);
  });

  it("keeps the owner's own example exact: goods Rp 12.666,99 and a 2,5% fee of Rp 316,67475", () => {
    const one: Costs = new Map([["21", { quantity: 1n, available: 1n, total: 12_666.99, unitCost: 12_666.99, batches: [] }]]);
    const goods = goodsCostOf({ lines: [line(21n, 1)], owners: undefined, costs: one, teamId: SELLER });
    const fee = (goods * 2.5) / 100;

    expect(goods).toBe(12_666.99);
    expect(fee).toBeCloseTo(316.67475, 9);
    // Shown to 3 places, half away from zero — the stored figure stays 316,67475.
    expect(formatRupiah(fee)).toBe("Rp 316,675");
    expect(formatRupiah(goods + fee)).toBe("Rp 12.983,665");
  });
});

describe("the invoice an owner is charged", () => {
  it("is the owner's lines summed exactly — as the ledger posts it", () => {
    const owners = new Map([
      ["11", { teamId: OWNER, crossMarkupBps: 0 }],
      ["12", { teamId: OWNER, crossMarkupBps: 0 }],
      ["13", { teamId: OWNER, crossMarkupBps: 0 }],
    ]);
    const [row] = invoiceRows({
      lines,
      owners,
      costs,
      teamId: SELLER,
      warehouseId: 0n,
      warehouseFee: 0,
      teamName: () => "Owner",
    });

    expect(row?.base).toBeCloseTo(60_001.2, 6);
    expect(row?.owed).toBeCloseTo(60_001.2, 6);
  });

  it("charges the warehouse its exact fee, and the credit row adds that same figure", () => {
    const rows = invoiceRows({
      lines,
      owners: undefined,
      costs,
      teamId: SELLER,
      warehouseId: WAREHOUSE,
      warehouseFee: 316.67475,
      teamName: () => "Gudang",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.owed).toBe(316.67475);

    const [credit] = creditRows({
      invoice: rows,
      teamId: SELLER,
      warehouseId: WAREHOUSE,
      warehouseFee: 316.67475,
      teamName: () => "Gudang",
      credit: { status: "ready", byTeam: new Map([["3", { debt: 1_000.5, creditLimit: 2_000.25 }]]) },
    });
    expect(credit?.adds).toBe(316.67475);
    expect(credit?.figures).toEqual({ state: "ready", debt: 1_000.5, limit: 2_000.25 });
  });
});
