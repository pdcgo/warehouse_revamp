import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { emptyAddress } from "../../components/customers/AddressPicker";
import { emptyReceipt } from "../../components/orders/ReceiptUpload";
import type { PickedProduct } from "../../components/products/ProductSelect";
import { OrderAddressSchema } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderDraftItemSchema, OrderDraftSchema } from "../../gen/warehouse/selling/v1/order_draft_pb";
import type { OrderDraft } from "../../gen/warehouse/selling/v1/order_draft_pb";
import type { OrderForm, OrderFormAction, OrderRequest } from "./formState";
import { initialOrderForm, isDirty, orderFormReducer, workOf } from "./formState";

// THE ORDER FORM'S REDUCER (no-global-store-every-read-is-a-query-hook — a many-field form keeps its state in one
// reducer). The rules pinned here are the ones the page's old effects kept by hand: a draft, a product page and the
// team's default each seed ONCE, a receipt file fills only what is empty and only for the file still attached, the
// leave-guard's "nothing changed" is the form as seeded, items OR bundles, and Create's lock.
//
// `npm run test:unit` (vitest.unit.config.ts — plain Node, no browser).

function run(state: OrderForm, ...actions: OrderFormAction[]): OrderForm {
  return actions.reduce(orderFormReducer, state);
}

const blank = () => initialOrderForm({ warehouseId: 0n });

const kopi: PickedProduct = { id: 71n, productCode: "KOPI-1", name: "Kopi Gayo" };
const teh: PickedProduct = { id: 72n, productCode: "TEH-1", name: "Teh Melati" };

function pushedDraft(over: MessageInitShape<typeof OrderDraftSchema> = {}): OrderDraft {
  return create(OrderDraftSchema, {
    id: 201n,
    source: "scraperx",
    externalId: "MEL-9001",
    shopId: 22n,
    warehouseId: 11n,
    customerName: "Bu Lestari",
    customerPhone: "0812",
    buyerUsername: "lestari88",
    shipmentChannelId: 3n,
    platformTotal: 0,
    platformCreatedAtUnix: 0n,
    platformShipmentDeadlineUnix: 0n,
    address: create(OrderAddressSchema, { kodePos: "16915", addressLine: "Jl. Raya 1" }),
    items: [
      create(OrderDraftItemSchema, { unitPrice: 55000, quantity: 2 }),
      create(OrderDraftItemSchema, { unitPrice: 25000.5, quantity: 1 }),
    ],
    ...over,
  });
}

const typed = (s: OrderForm, field: "customerName" | "receiptCode", value: string) =>
  orderFormReducer(s, { type: "set", field, value });

describe("the form as it opens", () => {
  it("is empty, with only a product page's warehouse filled", () => {
    const s = initialOrderForm({ warehouseId: 11n });

    expect(s.warehouseId).toBe(11n);
    expect(s.lines).toEqual([]);
    expect(s.address).toBe(emptyAddress);
    expect(s.receipt).toBe(emptyReceipt);
    expect(s.contents).toBe("items");
    expect(s.sent).toBeNull();
    expect(isDirty(s, false)).toBe(false);
  });

  it("is dirty once anything is typed — never for the warehouse alone, which arrives pre-filled", () => {
    expect(isDirty(initialOrderForm({ warehouseId: 11n }), false)).toBe(false);
    expect(isDirty(typed(blank(), "customerName", "Bu Ani"), false)).toBe(true);
    expect(isDirty(typed(blank(), "receiptCode", "JX1"), false)).toBe(true);
  });

  it("draws nothing for a value it already holds, as a useState setter", () => {
    const s = blank();

    expect(orderFormReducer(s, { type: "set", field: "customerName", value: "" })).toBe(s);
    expect(typed(s, "customerName", "Bu Ani").customerName).toBe("Bu Ani");
  });
});

describe("a draft seeds the form once", () => {
  it("fills the buyer, the shop, the marketplace's ref, the courier and its warehouse — and no line", () => {
    const s = run(blank(), { type: "seedDraft", draft: pushedDraft() });

    expect(s.customerName).toBe("Bu Lestari");
    expect(s.customerPhone).toBe("0812");
    expect(s.buyerUsername).toBe("lestari88");
    expect(s.shipmentChannelId).toBe(3n);
    expect(s.marketplace.shopId).toBe(22n);
    expect(s.marketplace.orderExternalRefId).toBe("MEL-9001");
    expect(s.warehouseId).toBe(11n);
    expect(s.address.addressLine).toBe("Jl. Raya 1");
    expect(s.lines).toEqual([]);
    expect(s.seededDraft).toBe("201");
  });

  it("prices it from the draft's platform_total, else the rows summed — exact, a fraction kept", () => {
    expect(run(blank(), { type: "seedDraft", draft: pushedDraft({ platformTotal: 99000.25 }) }).marketplace.platformTotal).toBe(
      "99000.25",
    );
    expect(run(blank(), { type: "seedDraft", draft: pushedDraft() }).marketplace.platformTotal).toBe("135000.5");
  });

  it("keeps a hand-written draft's reference out of the order's ref", () => {
    const s = run(blank(), { type: "seedDraft", draft: pushedDraft({ source: "manual" }) });

    expect(s.marketplace.orderExternalRefId).toBe("");
  });

  it("leaves the warehouse alone when the draft names none", () => {
    const s = run(initialOrderForm({ warehouseId: 0n }), { type: "defaultWarehouse", teamId: 12n, preferred: 14n }, {
      type: "seedDraft",
      draft: pushedDraft({ warehouseId: 0n }),
    });

    expect(s.warehouseId).toBe(14n);
  });

  it("is untouched as seeded, and dirty once changed", () => {
    const s = run(blank(), { type: "seedDraft", draft: pushedDraft() });

    expect(isDirty(s, true)).toBe(false);
    const changed = typed(s, "customerName", "Pak Budi");
    expect(isDirty(changed, true)).toBe(true);
  });

  it("takes a re-read of the same draft as nothing — what was typed stays", () => {
    const seeded = run(blank(), { type: "seedDraft", draft: pushedDraft() });
    const afterTyping = typed(seeded, "customerName", "Pak Budi");

    const reread = orderFormReducer(afterTyping, {
      type: "seedDraft",
      draft: pushedDraft({ customerName: "Bu Sekar", customerPhone: "0899", externalId: "MEL-9001-B" }),
    });

    expect(reread).toBe(afterTyping);
    expect(reread.customerName).toBe("Pak Budi");
  });

  it("counts a receipt attached before the draft arrived as work", () => {
    const attached = run(blank(), { type: "receipt", value: { documentId: "d1", filename: "a.pdf", mimeType: "x" } });
    const s = orderFormReducer(attached, { type: "seedDraft", draft: pushedDraft() });

    expect(isDirty(s, true)).toBe(true);
  });
});

describe("a product page seeds the form once", () => {
  it("starts with that product as the one line, at the quantity chosen there, untouched", () => {
    const s = run(blank(), { type: "seedPreset", productId: 73n, product: { ...kopi, id: 73n }, quantity: "3" });

    expect(s.lines.map((l) => [l.productId, l.quantity])).toEqual([[73n, "3"]]);
    expect(s.seedSignature).toBe(workOf(s));
    expect(isDirty(s, true)).toBe(false);
  });

  it("never re-seeds over a changed quantity", () => {
    const seeded = run(blank(), { type: "seedPreset", productId: 73n, product: { ...kopi, id: 73n }, quantity: "3" });
    const changed = orderFormReducer(seeded, { type: "patchLine", productId: 73n, patch: { quantity: "5" } });

    const reread = orderFormReducer(changed, {
      type: "seedPreset",
      productId: 73n,
      product: { ...kopi, id: 73n, name: "Kopi Baru" },
      quantity: "3",
    });

    expect(reread).toBe(changed);
    expect(reread.lines[0]!.quantity).toBe("5");
    expect(isDirty(reread, true)).toBe(true);
  });

  it("is not dirty before its product has arrived", () => {
    const s = blank();

    expect(isDirty(s, true)).toBe(false);
  });
});

describe("the team's default warehouse fills once", () => {
  it("fills an untouched field", () => {
    expect(run(blank(), { type: "defaultWarehouse", teamId: 12n, preferred: 14n }).warehouseId).toBe(14n);
  });

  it("never overwrites a warehouse already there — a product page's, or one picked", () => {
    expect(
      run(initialOrderForm({ warehouseId: 11n }), { type: "defaultWarehouse", teamId: 12n, preferred: 14n }).warehouseId,
    ).toBe(11n);
  });

  it("takes only the first answer: a later one with a default puts nothing back", () => {
    const s = run(
      blank(),
      { type: "defaultWarehouse", teamId: 12n, preferred: 0n },
      { type: "defaultWarehouse", teamId: 12n, preferred: 14n },
    );

    expect(s.warehouseId).toBe(0n);
  });

  it("loses to a draft's warehouse that arrives after it", () => {
    const s = run(blank(), { type: "defaultWarehouse", teamId: 12n, preferred: 14n }, { type: "seedDraft", draft: pushedDraft() });

    expect(s.warehouseId).toBe(11n);
  });
});

describe("the receipt file fills only what is empty, once, for the file still attached", () => {
  const label = { result: "read" as const, orderRefId: "240927QRST5821", trackingCode: "JX1234" };

  it("fills both empty boxes and says so", () => {
    const file = new File(["%PDF"], "label.pdf");
    const s = run(blank(), { type: "receiptFile", file }, { type: "scanned", file, found: label });

    expect(s.marketplace.orderExternalRefId).toBe("240927QRST5821");
    expect(s.receiptCode).toBe("JX1234");
    expect(s.scan).toBe(label);
    expect(s.filledFromFile).toBe(true);
  });

  it("never overwrites a typed box", () => {
    const file = new File(["%PDF"], "label.pdf");
    const s = run(blank(), { type: "set", field: "receiptCode", value: "TYPED-1" }, { type: "receiptFile", file }, {
      type: "scanned",
      file,
      found: label,
    });

    expect(s.receiptCode).toBe("TYPED-1");
    expect(s.marketplace.orderExternalRefId).toBe("240927QRST5821");
  });

  it("says it filled nothing when both boxes were typed", () => {
    const file = new File(["%PDF"], "label.pdf");
    const s = run(
      blank(),
      { type: "marketplacePatch", patch: { orderExternalRefId: "MINE" } },
      { type: "set", field: "receiptCode", value: "TYPED-1" },
      { type: "receiptFile", file },
      { type: "scanned", file, found: label },
    );

    expect(s.filledFromFile).toBe(false);
    expect(s.scan).toBe(label);
  });

  it("ignores the read of a file that was replaced before it answered", () => {
    const first = new File(["%PDF"], "first.pdf");
    const second = new File(["%PDF"], "second.pdf");
    const s = run(blank(), { type: "receiptFile", file: first }, { type: "receiptFile", file: second }, {
      type: "scanned",
      file: first,
      found: label,
    });

    expect(s.receiptCode).toBe("");
    expect(s.scan).toBeNull();
  });

  it("keeps what the file said when the same file is reported again", () => {
    const file = new File(["%PDF"], "label.pdf");
    const scanned = run(blank(), { type: "receiptFile", file }, { type: "scanned", file, found: label });

    expect(orderFormReducer(scanned, { type: "receiptFile", file })).toBe(scanned);
  });

  it("keeps a box cleared after the fill as cleared — typing after it stays", () => {
    const file = new File(["%PDF"], "label.pdf");
    const s = run(blank(), { type: "receiptFile", file }, { type: "scanned", file, found: label }, {
      type: "set",
      field: "receiptCode",
      value: "",
    });

    expect(s.receiptCode).toBe("");
    expect(s.filledFromFile).toBe(true);
  });

  it("drops what the file said when the receipt is removed, keeping the numbers it filled", () => {
    const file = new File(["%PDF"], "label.pdf");
    const attached = { documentId: "d1", filename: "label.pdf", mimeType: "application/pdf" };
    const s = run(
      blank(),
      { type: "receiptFile", file },
      { type: "receipt", value: attached },
      { type: "scanned", file, found: label },
      { type: "receipt", value: emptyReceipt },
    );

    expect(s.receiptFile).toBeNull();
    expect(s.scan).toBeNull();
    expect(s.filledFromFile).toBe(false);
    expect(s.receiptCode).toBe("JX1234");
  });
});

describe("the lines and the bundles", () => {
  it("reconciles a pick: a still-ticked product keeps its typed quantity", () => {
    const s = run(
      blank(),
      { type: "pickProducts", products: [kopi] },
      { type: "patchLine", productId: 71n, patch: { quantity: "4" } },
      { type: "pickProducts", products: [kopi, teh] },
    );

    expect(s.lines.map((l) => [l.productId, l.quantity])).toEqual([
      [71n, "4"],
      [72n, "1"],
    ]);
    expect(run(s, { type: "removeLine", productId: 71n }).lines.map((l) => l.productId)).toEqual([72n]);
  });

  it("switches from an empty card at once, and from a full one only after the confirm, emptying it", () => {
    expect(run(blank(), { type: "chooseContents", next: "bundles" }).contents).toBe("bundles");

    const holding = run(blank(), { type: "pickProducts", products: [kopi] }, { type: "chooseContents", next: "bundles" });
    expect(holding.contents).toBe("items");
    expect(holding.switchingTo).toBe("bundles");

    const kept = orderFormReducer(holding, { type: "cancelSwitch" });
    expect(kept.lines).toHaveLength(1);
    expect(kept.switchingTo).toBeNull();

    const switched = orderFormReducer(holding, { type: "confirmSwitch" });
    expect(switched.contents).toBe("bundles");
    expect(switched.lines).toEqual([]);
    expect(switched.switchingTo).toBeNull();
  });

  it("gives each added bundle its own key — the same bundle twice is two", () => {
    const picked = { id: 5n, name: "Hampers", slots: [] };
    const s = run(blank(), { type: "addBundle", picked }, { type: "addBundle", picked });

    expect(s.bundles.map((b) => b.key)).toEqual(["5-1", "5-2"]);
  });
});

describe("Create's lock", () => {
  const request = { teamId: 12n, shopId: 22n, orderExternalRefId: "R1", orderDraftId: 0n } as OrderRequest;

  it("locks on the frozen request, clearing the last answer's notices", () => {
    const failed = run(blank(), { type: "send", request }, { type: "answered", refusal: null, error: "boom" });
    expect(failed.sent).toBeNull();
    expect(failed.error).toBe("boom");

    const again = orderFormReducer(failed, { type: "send", request });
    expect(again.sent).toEqual({ phase: "waiting", request });
    expect(again.error).toBe("");
  });

  it("stays locked with no answer, and Go Back from Try Again gives the form back", () => {
    const lost = run(blank(), { type: "send", request }, { type: "noAnswer", request });
    expect(lost.sent?.phase).toBe("noAnswer");

    const back = run(lost, { type: "set", field: "retry", value: { ref: "R1", orders: [], drafts: [] } }, {
      type: "goBackFromRetry",
    });
    expect(back.sent).toBeNull();
    expect(back.retry).toBeNull();
  });
});
