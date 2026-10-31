import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { MovementRow } from "../inventory/MovementTable";

// ⚠ SAMPLE — ANOTHER TEAM'S STOCK HISTORY. Every team may read a product's stock history (owner: *"riwayat stok boleh
// dibaca semua orang"*, stock-history-is-everyones), but OwnerStockHistory answers only the team that owns the product,
// so the discover detail shows these rows for anybody else's — marked (its pending.ts `history`). The team's own product
// reads the real ledger.
//
// Each warehouse holding the product tells one story that ENDS AT ITS REAL SHELF: a delivery came in, then a few orders
// took from it, and what is left is what StockAvailability says is ready there now. So the sample never contradicts the
// figures above it. Deterministic per product; newest first.

const DAY = 86_400;

function isoDaysBack(days: number, hour: number): string {
  const now = Math.floor(Date.now() / 1000);
  return new Date((now - days * DAY - (now % DAY) + hour * 3600) * 1000).toISOString();
}

/** The movements behind each warehouse's ready stock — `shelves` is every warehouse and what is ready there. */
export function sampleHistory(productId: bigint, shelves: { warehouseId: bigint; ready: bigint }[]): MovementRow[] {
  const n = Number(productId % 97n);
  const rows: MovementRow[] = [];

  shelves
    .filter((s) => s.ready > 0n)
    .forEach((s, w) => {
      const picks = [1, 2, 3, 4].map((i) => BigInt(1 + ((n + i * 3 + w) % 4)));
      const received = s.ready + picks.reduce((a, b) => a + b, 0n);
      const base = Number(s.warehouseId) * 100;
      let balance = received;

      rows.push({
        id: BigInt(base + 1),
        createdAt: isoDaysBack(20 + (n % 9) + w, 9),
        kind: MovementKind.RECEIVE,
        delta: received,
        balance,
        actorUserId: 0n,
        batchId: productId * 10n + BigInt(w + 1),
        productId,
        warehouseId: s.warehouseId,
      });

      [12, 8, 4, 1].forEach((days, i) => {
        balance -= picks[i]!;
        rows.push({
          id: BigInt(base + 2 + i),
          createdAt: isoDaysBack(days + w, 14),
          kind: MovementKind.PICK,
          delta: -picks[i]!,
          balance,
          actorUserId: 0n,
          batchId: productId * 10n + BigInt(w + 1),
          productId,
          warehouseId: s.warehouseId,
        });
      });
    });

  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
