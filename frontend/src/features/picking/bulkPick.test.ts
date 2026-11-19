import { describe, expect, it } from "vitest";

import { create } from "@bufbuild/protobuf";

import { StockPickLocationSchema } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { OrderPickSchema, OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import type { BulkPickAnswer, BulkPickOrder } from "./bulkPick";
import { BULK_PICK_MAX, bulkPickAnswerOf, bulkPickIdsOf, bulkPickPath, groupByOrder, groupByProduct } from "./bulkPick";

// THE BULK PICK LIST'S ARITHMETIC (the-bulk-pick-list-prototype-is-accepted): per product — the total over every order and each rack once
// with its units summed, in walk order; per order — each line with ITS take's racks; units no take placed are counted,
// never dropped. `npm run test:unit` (vitest.unit.config.ts — plain Node, no browser).

function order(id: bigint, lines: [bigint, string, number][]): BulkPickOrder {
  return {
    id,
    transactionId: 70_000n + id,
    shopName: "Melati Official",
    marketplace: Marketplace.SHOPEE,
    orderExternalRefId: `SP-${id}`,
    shipmentChannelId: 91n,
    receiptCode: "",
    lines: lines.map(([productId, name, quantity]) => ({ productId, name, productCode: `P-${productId}`, quantity })),
  };
}

const loc = (orderId: bigint, productId: bigint, rackId: bigint, rackCode: string, quantity: bigint) => ({
  transactionId: 70_000n + orderId,
  productId,
  rackId,
  rackCode,
  quantity,
});

// Three orders: Kaos on two racks across them, Topi partly with no recorded rack, Kemeja only in the unplaced pile.
const ANSWER: BulkPickAnswer = {
  orders: [
    order(101n, [
      [301n, "Kaos", 2],
      [303n, "Topi", 1],
    ]),
    order(103n, [
      [301n, "Kaos", 1],
      [303n, "Topi", 2],
    ]),
    order(104n, [
      [501n, "Kemeja", 1],
      [301n, "Kaos", 1],
    ]),
  ],
  locations: [
    loc(101n, 301n, 42n, "A-01-2", 1n),
    loc(101n, 301n, 41n, "A-01-1", 1n),
    // 101's Topi: no rack recorded at all (an order placed before stock integration).
    loc(103n, 301n, 41n, "A-01-1", 1n),
    loc(103n, 303n, 43n, "B-02-1", 2n),
    loc(104n, 501n, 0n, "", 1n),
    loc(104n, 301n, 42n, "A-01-2", 1n),
    // Another order's take, never asked for: must not leak into anybody's racks.
    loc(999n, 301n, 41n, "A-01-1", 7n),
  ],
};

describe("groupByProduct", () => {
  const products = groupByProduct(ANSWER);

  it("totals each product over every order, each rack once with its units summed", () => {
    const kaos = products.find((p) => p.productId === 301n)!;

    expect(kaos.total).toBe(4);
    expect(kaos.orderCount).toBe(3);
    expect(kaos.racks).toEqual([
      { rackId: 41n, rackCode: "A-01-1", quantity: 2 },
      { rackId: 42n, rackCode: "A-01-2", quantity: 2 },
    ]);
    expect(kaos.unrecorded).toBe(0);
  });

  it("counts the units no take placed instead of dropping them", () => {
    const topi = products.find((p) => p.productId === 303n)!;

    expect(topi.total).toBe(3);
    expect(topi.racks).toEqual([{ rackId: 43n, rackCode: "B-02-1", quantity: 2 }]);
    expect(topi.unrecorded).toBe(1);
  });

  it("lists in walk order: by the first placed rack, a product on no rack last", () => {
    expect(products.map((p) => p.productId)).toEqual([301n, 303n, 501n]);
    expect(products[2]!.racks).toEqual([{ rackId: 0n, rackCode: "", quantity: 1 }]);
  });
});

describe("groupByOrder", () => {
  const picks = groupByOrder(ANSWER);

  it("keeps the ticked order, each line with its own take's racks only", () => {
    expect(picks.map((p) => p.order.id)).toEqual([101n, 103n, 104n]);

    const first = picks[0]!;
    expect(first.units).toBe(3);
    expect(first.lines[0]).toMatchObject({ productId: 301n, quantity: 2, unrecorded: 0 });
    expect(first.lines[0]!.racks.map((r) => [r.rackCode, r.quantity])).toEqual([
      ["A-01-1", 1],
      ["A-01-2", 1],
    ]);
    expect(first.lines[1]).toMatchObject({ productId: 303n, quantity: 1, racks: [], unrecorded: 1 });
  });

  it("puts the unplaced pile after the placed racks", () => {
    const merged = groupByOrder({
      orders: [order(105n, [[301n, "Kaos", 3]])],
      locations: [loc(105n, 301n, 0n, "", 1n), loc(105n, 301n, 43n, "B-02-1", 2n)],
    });

    expect(merged[0]!.lines[0]!.racks.map((r) => r.rackId)).toEqual([43n, 0n]);
  });

  it("sums a product on two lines of one order into one line", () => {
    const twice = groupByOrder({
      orders: [order(106n, [
        [301n, "Kaos", 1],
        [301n, "Kaos", 2],
      ])],
      locations: [loc(106n, 301n, 41n, "A-01-1", 3n)],
    });

    expect(twice[0]!.lines).toHaveLength(1);
    expect(twice[0]!.lines[0]).toMatchObject({ quantity: 3, unrecorded: 0 });
  });
});

describe("the address", () => {
  it("round-trips the ids, dropping junk and repeats, at most fifty", () => {
    expect(bulkPickPath([103n, 104n])).toBe("/warehouse-orders/bulk-pick?ids=103,104");
    expect(bulkPickIdsOf("?ids=103,x,104,103,0&view=order")).toEqual([103n, 104n]);

    const many = Array.from({ length: 60 }, (_, i) => BigInt(i + 1));
    expect(bulkPickIdsOf(`?ids=${many.join(",")}`)).toHaveLength(BULK_PICK_MAX);
  });
});

describe("the reads, as the page holds them", () => {
  it("labels each order from its shop, keeps the asked order, and files every rack under its take", () => {
    const answer = bulkPickAnswerOf(
      [
        create(OrderPickSchema, {
          orderId: 104n,
          transactionId: 70_104n,
          status: OrderStatus.PROCESSED,
          shopId: 23n,
          orderExternalRefId: "LZ-4471902",
          shipmentChannelId: 95n,
          receiptCode: "JP0001",
          lines: [{ productId: 302n, productCode: "KPP-L", name: "Kaos Putih", quantity: 2 }],
        }),
        create(OrderPickSchema, { orderId: 103n, transactionId: 70_103n, shopId: 99n, lines: [] }),
      ],
      [create(StockPickLocationSchema, { transactionId: 70_104n, productId: 302n, rackId: 43n, rackCode: "B-02-1", quantity: 2n })],
      new Map([["23", { name: "Toko Lazada", marketplace: Marketplace.LAZADA }]]),
    );

    expect(answer.orders.map((o) => o.id)).toEqual([104n, 103n]);
    expect(answer.orders[0]).toMatchObject({
      transactionId: 70_104n,
      shopName: "Toko Lazada",
      marketplace: Marketplace.LAZADA,
      orderExternalRefId: "LZ-4471902",
      shipmentChannelId: 95n,
      receiptCode: "JP0001",
      lines: [{ productId: 302n, productCode: "KPP-L", name: "Kaos Putih", quantity: 2 }],
    });
    // A shop whose name has not landed reads blank, never another shop's.
    expect(answer.orders[1]).toMatchObject({ shopName: "", marketplace: Marketplace.UNSPECIFIED });
    expect(answer.locations).toEqual([{ transactionId: 70_104n, productId: 302n, rackId: 43n, rackCode: "B-02-1", quantity: 2n }]);
    expect(groupByOrder(answer)[0]!.lines[0]!.racks).toEqual([{ rackId: 43n, rackCode: "B-02-1", quantity: 2 }]);
  });
});
