import { describe, expect, it } from "vitest";

import { CUSTOM, NO_RANGE, PRICE_BANDS, PRICE_MAX, STOCK_BANDS, STOCK_MAX, rangeAsk } from "./ranges";

// WHAT A DISCOVER RANGE ASKS THE SERVER (discover-ranges-are-picked): both ends included, the top open-ended (the build's
// default under a-cross-band-keeps-a-range-that-touches-it).
describe("rangeAsk", () => {
  it("asks nothing for Semua, or a custom range with both boxes empty", () => {
    expect(rangeAsk(NO_RANGE, STOCK_BANDS, STOCK_MAX)).toBeUndefined();
    expect(rangeAsk({ band: CUSTOM, min: "", max: "" }, STOCK_BANDS, STOCK_MAX)).toBeUndefined();
  });

  it("asks a band's own two ends", () => {
    expect(rangeAsk({ ...NO_RANGE, band: "11-50" }, STOCK_BANDS, STOCK_MAX)).toEqual({ min: 11, max: 50 });
    expect(rangeAsk({ ...NO_RANGE, band: "0-0" }, STOCK_BANDS, STOCK_MAX)).toEqual({ min: 0, max: 0 });
    expect(rangeAsk({ ...NO_RANGE, band: "25000-50000" }, PRICE_BANDS, PRICE_MAX)).toEqual({ min: 25000, max: 50000 });
  });

  it("leaves the top band open — nothing past the ceiling falls out of every band", () => {
    expect(rangeAsk({ ...NO_RANGE, band: "10001-100000" }, STOCK_BANDS, STOCK_MAX)).toEqual({ min: 10001 });
    expect(rangeAsk({ ...NO_RANGE, band: "500000-1000000" }, PRICE_BANDS, PRICE_MAX)).toEqual({ min: 500000 });
  });

  it("reads a custom range: empty min is 0, empty max no edge, a max held at the ceiling open, backwards turned round", () => {
    expect(rangeAsk({ band: CUSTOM, min: "", max: "40" }, STOCK_BANDS, STOCK_MAX)).toEqual({ min: 0, max: 40 });
    expect(rangeAsk({ band: CUSTOM, min: "7", max: "" }, STOCK_BANDS, STOCK_MAX)).toEqual({ min: 7 });
    expect(rangeAsk({ band: CUSTOM, min: "7", max: "100000" }, STOCK_BANDS, STOCK_MAX)).toEqual({ min: 7 });
    expect(rangeAsk({ band: CUSTOM, min: "50", max: "10" }, STOCK_BANDS, STOCK_MAX)).toEqual({ min: 10, max: 50 });
    expect(rangeAsk({ band: CUSTOM, min: "15000", max: "30000" }, PRICE_BANDS, PRICE_MAX)).toEqual({ min: 15000, max: 30000 });
  });

  it("reads a band the codec no longer knows as nothing", () => {
    expect(rangeAsk({ ...NO_RANGE, band: "3-4" }, STOCK_BANDS, STOCK_MAX)).toBeUndefined();
  });
});
