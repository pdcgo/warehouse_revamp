import { describe, expect, it } from "vitest";

import { lineUnitBeli, linesGoodsCost, orderMargin, orderMarginPct, orderSpend } from "../features/orders/margin";
import {
  formatRupiah,
  formatRupiahBare,
  formatRupiahCompact,
  formatRupiahNumber,
  formatRupiahRange,
  formatSignedRupiah,
  isZeroRupiah,
  rupiahNumber,
  signOfRupiah,
} from "./money";

// THE TWO SHAPES OF A RUPIAH: the wire gives an exact `double` (the-backend-never-rounds-money), an old fixture or a
// whole figure may still be a bigint — and a formatter must read both the same, so a field moving
// from one to the other changes nothing on screen.
//
// `npm run test:unit` (vitest.unit.config.ts — plain Node, no browser).

describe("the comparison helpers (the-backend-never-rounds-money)", () => {
  it("widens a bigint and keeps a number exact", () => {
    expect(rupiahNumber(125_000n)).toBe(125_000);
    expect(rupiahNumber(316.67475)).toBe(316.67475);
    expect(rupiahNumber(Number.NaN)).toBe(0);
  });

  it("reads zero to 4 places, as san_money.IsZero does — dust is zero, a fraction is not", () => {
    expect(isZeroRupiah(0)).toBe(true);
    expect(isZeroRupiah(0.00004)).toBe(true);
    expect(isZeroRupiah(-0.00004)).toBe(true);
    expect(isZeroRupiah(0.4)).toBe(false);
    expect(isZeroRupiah(0n)).toBe(true);
  });

  it("gives the sign within the same tolerance", () => {
    expect(signOfRupiah(316.675)).toBe(1);
    expect(signOfRupiah(-0.4)).toBe(-1);
    expect(signOfRupiah(1e-9)).toBe(0);
  });
});

describe("the formatters take either shape", () => {
  it("formatRupiah writes a number exactly as the bigint of the same value", () => {
    expect(formatRupiah(25_000)).toBe(formatRupiah(25_000n));
    expect(formatRupiah(-10_000)).toBe(formatRupiah(-10_000n));
    expect(formatRupiah(-10_000)).toBe(`−Rp ${(10_000).toLocaleString("id-ID")}`);
  });

  it("never prints −Rp 0 for a negative zero or a fraction that rounds to nothing at 3 places", () => {
    expect(formatRupiah(-0)).toBe("Rp 0");
    expect(formatRupiah(-0.0004)).toBe("Rp 0");
    expect(formatSignedRupiah(-0)).toBe("Rp 0");
    expect(formatSignedRupiah(-0.0004)).toBe("Rp 0");
  });

  it("formatSignedRupiah, formatRupiahRange and formatRupiahCompact agree across the shapes", () => {
    expect(formatSignedRupiah(4_000)).toBe(formatSignedRupiah(4_000n));
    expect(formatSignedRupiah(-4_000)).toBe(formatSignedRupiah(-4_000n));
    expect(formatRupiahRange(5_000, 5_000n)).toBe(formatRupiah(5_000n));
    expect(formatRupiahRange(45_700, 47_200)).toBe(formatRupiahRange(45_700n, 47_200n));
    expect(formatRupiahCompact(1_500_000)).toBe(formatRupiahCompact(1_500_000n));
  });

  it("formatRupiahNumber is formatRupiah of the number", () => {
    expect(formatRupiahNumber(10_750_000)).toBe(formatRupiah(10_750_000n));
    expect(formatRupiahNumber(10_750_000.4)).toBe(formatRupiah(10_750_000.4));
  });
});

// a-fraction-of-a-rupiah-shows-three-decimals: storage is exact (the-backend-never-rounds-money); on SCREEN a figure
// with a fraction shows up to 3 decimals, Indonesian form, trailing zeros dropped. Display only.
describe("a fraction of a rupiah shows up to three decimals", () => {
  it("writes a whole figure with no decimals, number or bigint", () => {
    expect(formatRupiah(12_345)).toBe("Rp 12.345");
    expect(formatRupiah(12_345n)).toBe("Rp 12.345");
    expect(formatRupiah(12_345.0000001)).toBe("Rp 12.345");
  });

  it("writes 1, 2 or 3 decimals after a comma, trailing zeros dropped", () => {
    expect(formatRupiah(12_345.5)).toBe("Rp 12.345,5");
    expect(formatRupiah(12_345.25)).toBe("Rp 12.345,25");
    expect(formatRupiah(12_345.505)).toBe("Rp 12.345,505");
    expect(formatRupiah(12_345.5)).toBe(formatRupiah(12_345.500));
    expect(formatRupiah(0.75)).toBe("Rp 0,75");
  });

  it("rounds the 4th decimal half away from zero, binary dust included", () => {
    expect(formatRupiah(12_345.5054)).toBe("Rp 12.345,505");
    expect(formatRupiah(12_345.5055)).toBe("Rp 12.345,506");
    expect(formatRupiah(1.0005)).toBe("Rp 1,001");
    expect(formatRupiah(12_345.9996)).toBe("Rp 12.346");
    expect(formatRupiah(-1.0005)).toBe("−Rp 1,001");
  });

  it("puts the minus before Rp on a negative fraction", () => {
    expect(formatRupiah(-12_345.5)).toBe("−Rp 12.345,5");
    expect(formatRupiah(-0.25)).toBe("−Rp 0,25");
  });

  it("signs a fraction both ways", () => {
    expect(formatSignedRupiah(4_000.25)).toBe("+Rp 4.000,25");
    expect(formatSignedRupiah(-4_000.25)).toBe("−Rp 4.000,25");
  });

  it("writes a range of two fractions, and one price when both ends read the same", () => {
    expect(formatRupiahRange(45_700.5, 47_200.125)).toBe("Rp 45.700,5 – Rp 47.200,125");
    expect(formatRupiahRange(5_000.0001, 5_000)).toBe("Rp 5.000");
    expect(formatRupiahRange(5_000.5, 5_000)).toBe("Rp 5.000,5 – Rp 5.000");
  });

  it("keeps compact's one scaled decimal from Rp 1rb up, and shows the fraction below it", () => {
    expect(formatRupiahCompact(1_500_000.75)).toBe("Rp 1,5jt");
    expect(formatRupiahCompact(12_345.505)).toBe("Rp 12,3rb");
    expect(formatRupiahCompact(512.75)).toBe("Rp 512,75");
    expect(formatRupiahCompact(-512.75)).toBe("−Rp 512,75");
  });

  it("bare drops only the Rp", () => {
    expect(formatRupiahBare(10_750_000.5)).toBe("10.750.000,5");
    expect(formatRupiahBare(-150_000.25)).toBe("−150.000,25");
  });

  it("reads NaN and the infinities as Rp 0 rather than throwing", () => {
    expect(formatRupiah(Number.NaN)).toBe("Rp 0");
    expect(formatRupiah(Number.NEGATIVE_INFINITY)).toBe("Rp 0");
  });
});

describe("the margin is taken from doubles", () => {
  it("is the same margin whichever shape the revenue arrives in", () => {
    expect(orderMargin(150_000, 100_000)).toBe(orderMargin(150_000n, 100_000));
    expect(orderMargin(150_000, 100_000)).toBe(50_000);
    expect(orderMarginPct(150_000, 100_000)).toBe(33.3);
  });

  it("keeps an unrounded fee's fraction in the margin, and the percentage to one decimal", () => {
    // goods 100.000 (frozen whole) + a fee of 2.345,5 (frozen unrounded) against 150.000 paid.
    const spend = orderSpend(100_000, 2_345.5, true);
    expect(spend).toBe(102_345.5);
    expect(orderMargin(150_000, spend)).toBe(47_654.5);
    expect(formatRupiah(orderMargin(150_000, spend)!)).toBe("Rp 47.654,5");
    expect(orderMarginPct(150_000, spend)).toBe(31.7);
  });

  it("reads a loss as a negative margin, never −0", () => {
    expect(orderMargin(100_000, 100_000.4)).toBeCloseTo(-0.4, 9);
    expect(orderMarginPct(100_000, 100_000)).toBe(0);
    expect(Object.is(orderMarginPct(100_000, 100_000.4), -0)).toBe(false);
  });

  it("refuses a revenue of 0 — not recorded, not a sale of nothing", () => {
    expect(orderMargin(0, 100_000)).toBeNull();
    // Float dust is no sale; a real fraction is one (the-backend-never-rounds-money — nothing rounds it away).
    expect(orderMarginPct(0.00004, 100_000)).toBeNull();
    expect(orderMargin(0.3, 0)).toBe(0.3);
    expect(orderMargin(150_000, orderSpend(0, 0, false))).toBeNull();
  });

  it("sums the lines' frozen totals exactly — the goods cost is never rounded", () => {
    const lines = [
      { quantity: 3, unitCost: 3_333, unitCostWithMarkup: 3_333.3333, total: 9_999.9999 },
      { quantity: 1, unitCost: 1_000, total: 1_000.4 },
    ];
    expect(linesGoodsCost(lines)).toBeCloseTo(11_000.3999, 9);
    expect(formatRupiah(linesGoodsCost(lines))).toBe("Rp 11.000,4");
    expect(lineUnitBeli(lines[0]!)).toBe(3_333.3333);
    expect(formatRupiah(lineUnitBeli(lines[0]!))).toBe("Rp 3.333,333");
  });
});
