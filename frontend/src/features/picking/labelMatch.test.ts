import { describe, expect, it } from "vitest";

import { carriesLabel, labelId } from "./labelMatch";

// WHICH ORDER A SCANNED CODE IS (a-label-scan-reads-the-ref-or-the-receipt): the tracking number, the marketplace ref or
// the id — equal, in any case, never a part of one.
//
// `npm run test:unit` (vitest.unit.config.ts — plain Node, no browser).

const order = { id: 9001n, receiptCode: "SPXID0123456789", orderExternalRefId: "2410ABC" };

describe("carriesLabel", () => {
  it("matches the tracking number, the ref and the id", () => {
    expect(carriesLabel(order, "SPXID0123456789")).toBe(true);
    expect(carriesLabel(order, "2410ABC")).toBe(true);
    expect(carriesLabel(order, "9001")).toBe(true);
  });

  it("ignores case and the spaces a scanner may add", () => {
    expect(carriesLabel(order, "  spxid0123456789 ")).toBe(true);
    expect(carriesLabel(order, "2410abc")).toBe(true);
  });

  it("never matches a part of a code — the server's search is a substring one, the scan is not", () => {
    expect(carriesLabel(order, "SPXID012345678")).toBe(false);
    expect(carriesLabel(order, "2410")).toBe(false);
    expect(carriesLabel(order, "900")).toBe(false);
    expect(carriesLabel(order, "")).toBe(false);
  });

  it("an order with no tracking number or ref is matched by its id alone", () => {
    const bare = { id: 42n, receiptCode: "", orderExternalRefId: "" };
    expect(carriesLabel(bare, "42")).toBe(true);
    expect(carriesLabel(bare, "")).toBe(false);
  });
});

describe("labelId", () => {
  it("reads digits within a uint64, nothing else", () => {
    expect(labelId("9001")).toBe(9001n);
    expect(labelId("0")).toBeUndefined();
    expect(labelId("SPX1")).toBeUndefined();
    expect(labelId("18446744073709551616")).toBeUndefined();
    expect(labelId("123456789012345678901")).toBeUndefined();
  });
});
