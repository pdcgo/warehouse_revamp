import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { OrderDraftSchema } from "../../gen/warehouse/selling/v1/order_draft_pb";
import { OrderAddressSchema } from "../../gen/warehouse/selling/v1/order_pb";

import { draftGaps, isDraftReady } from "./draftReadiness";

// THE DRAFTS LIST'S READY (the-drafts-list-counts-no-mapping): a shop, a warehouse, a customer, an address, a courier,
// and every other gap filled — never a mapping, which a draft does not store (a-draft-stores-no-mapping).
const ready = () =>
  create(OrderDraftSchema, {
    source: "ScraperX",
    shopId: 21n,
    warehouseId: 11n,
    customerName: "Budi",
    address: create(OrderAddressSchema, { addressLine: "Jl. Merdeka 1" }),
    shipmentChannelId: 1n,
    itemCount: 2,
    platformCreatedAtUnix: 1_700_000_000n,
    platformTotal: 135_000,
  });

const keys = (d: ReturnType<typeof ready>) => draftGaps(d).map((g) => g.key);

describe("draftGaps", () => {
  it("calls a draft with every field filled ready — its lines are mapped in the order form, not here", () => {
    expect(isDraftReady(ready())).toBe(true);
  });

  it("names a missing address line and a missing courier, in that order after the customer", () => {
    const d = ready();
    d.customerName = "";
    d.address = create(OrderAddressSchema, { provinsiName: "Jawa Barat" });
    d.shipmentChannelId = 0n;

    expect(keys(d)).toEqual(["orderDrafts.missingCustomer", "orderDrafts.gapAddress", "orderDrafts.gapCourier"]);
  });

  it("treats a draft with no address at all as missing one", () => {
    const d = ready();
    d.address = undefined;

    expect(keys(d)).toEqual(["orderDrafts.gapAddress"]);
  });

  it("never names unmapped lines", () => {
    const d = ready();
    d.itemCount = 3;

    expect(keys(d)).not.toContain("orderDrafts.unmappedLines");
    expect(isDraftReady(d)).toBe(true);
  });
});
