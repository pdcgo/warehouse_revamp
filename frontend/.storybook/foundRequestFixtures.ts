// A found at the shelf waiting for the warehouse Owner or Admin (an-adjust-found-waits-for-the-owner-or-admin), served
// by foundRequestStub.ts, which plays the server's rules (inventory_v1/found_request_*.go).
//
// Gudang Pusat (11). The signed-in person is Ani (61); Budi (62) is the Admin, Dewi (64) the Owner.
//
//   #301  WAITING   Beras ×4 on B-02-1, by Budi — claims loss #91 (2 @ 62.000, batch #7) and loss #95 (1 @ 65.000,
//                   batch #9), oldest first, then mints 1 at the newest price here, 65.000
//   #302  WAITING   Minyak ×1 on B-02-1, by ANI — she reported it, so she may not approve it; she may withdraw it
//   #303  WAITING   Gula Pasir ×2 on A-01-2, by Dewi — stock count #15 holds Gula Pasir on A-01-2: not yet
//   #290  APPROVED  Tepung ×1 on A-01-1, by Budi, approved by Dewi — claimed loss #80 back into batch #15
//   #288  REJECTED  Minyak ×1 on A-01-1, by ANI, withdrawn by Ani herself (the-reporter-may-withdraw-their-found)
//   #286  SETTLED   Gula Pasir ×1 on A-01-1, by Budi — stock count #12 counted it and posted it itself
//                   (a-count-settles-the-found-it-counted)
//   #285  REJECTED  Beras ×2 on A-01-2, by Budi, rejected by Dewi — an order's parcel waiting for its pick
//
// Kopi Arabika (71) has no batch here: its team never had it in Gudang Pusat, so a report of it is refused
// (a-found-never-stocked-here-is-refused-at-the-report).
//
// ⚠ Requests are kept as STATE: a WAITING one's lines are worked out from the register each read, the way the server
// will (a-surplus-claims-the-oldest-loss-first, last-price-is-the-teams-newest-batch-here).

import { FoundRequestPostType, FoundRequestStatus } from "../src/gen/warehouse/inventory/v1/found_request_pb";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (seconds: number) => BigInt(Math.floor(Date.now() / 1000) - seconds);

export const ANI = 61n;
export const BUDI = 62n;
export const DEWI = 64n;

export interface FoundPostedLine {
  type: FoundRequestPostType;
  batchId: bigint;
  stockCount: bigint;
  priceUnit: bigint;
  problemId: bigint;
  problemCreatedAtUnix: bigint;
}

export interface FoundRequestFixture {
  id: bigint;
  warehouseId: bigint;
  teamId: bigint;
  productId: bigint;
  productCode: string;
  productName: string;
  rackId: bigint;
  rackCode: string;
  stockCount: bigint;
  note: string;
  reportedById: bigint;
  reportedAtUnix: bigint;
  status: FoundRequestStatus;
  decidedById: bigint;
  decidedAtUnix: bigint;
  rejectReason: string;
  /** SETTLED_BY_COUNT: the count whose finalize closed it. */
  settledByCountingSessionId: bigint;
  /** APPROVED: what it posted. A waiting one's lines are worked out on each read. */
  posted: FoundPostedLine[];
  transactionId: bigint;
}

/** An open lost row of the register (warehouse_stock_problems) a found claims back, oldest first. */
export interface FoundLossFixture {
  id: bigint;
  warehouseId: bigint;
  teamId: bigint;
  productId: bigint;
  batchId: bigint;
  priceUnit: bigint;
  claimable: bigint;
  claimed: bigint;
  createdAtUnix: bigint;
}

/** A batch of a team's product in a warehouse, by id oldest first — an emptied one keeps its price for the mint. */
export interface FoundBatchFixture {
  id: bigint;
  warehouseId: bigint;
  teamId: bigint;
  productId: bigint;
  priceUnit: bigint;
}

/** A stock count holding a product on a rack — its open snapshot row (the-lock-is-the-open-snapshot-row). */
export interface FoundLockFixture {
  warehouseId: bigint;
  productId: bigint;
  rackId: bigint;
  sessionId: bigint;
}

const BERAS = { teamId: 12n, productId: 74n, productCode: "SKU-BERAS-5K", productName: "Beras Pandan Wangi 5kg" };
const GULA = { teamId: 13n, productId: 73n, productCode: "SKU-GULA-1K", productName: "Gula Pasir 1kg" };
const MINYAK = { teamId: 15n, productId: 700n, productCode: "SL-03-ANG-001", productName: "Minyak Goreng Sawit 2L — Satuan" };
const TEPUNG = { teamId: 15n, productId: 702n, productCode: "SL-03-ANG-003", productName: "Tepung Terigu Serbaguna 1kg — Satuan" };

const A1 = { rackId: 41n, rackCode: "A-01-1" };
const A2 = { rackId: 42n, rackCode: "A-01-2" };
const B1 = { rackId: 43n, rackCode: "B-02-1" };

const waiting = {
  status: FoundRequestStatus.WAITING,
  decidedById: 0n,
  decidedAtUnix: 0n,
  rejectReason: "",
  settledByCountingSessionId: 0n,
  posted: [] as FoundPostedLine[],
  transactionId: 0n,
};

export const foundRequestFixtures: FoundRequestFixture[] = [
  { id: 285n, warehouseId: 11n, ...BERAS, ...A2, stockCount: 2n, note: "Two sacks by the packing table", reportedById: BUDI, reportedAtUnix: ago(9 * DAY + 3 * HOUR), status: FoundRequestStatus.REJECTED, decidedById: DEWI, decidedAtUnix: ago(9 * DAY), rejectReason: "Order #900's parcel waiting for its pick — not extra stock", settledByCountingSessionId: 0n, posted: [], transactionId: 0n },
  { id: 286n, warehouseId: 11n, ...GULA, ...A1, stockCount: 1n, note: "One pack behind the scale", reportedById: BUDI, reportedAtUnix: ago(21 * DAY), status: FoundRequestStatus.SETTLED_BY_COUNT, decidedById: DEWI, decidedAtUnix: ago(20 * DAY - 5 * HOUR), rejectReason: "", settledByCountingSessionId: 12n, posted: [], transactionId: 0n },
  { id: 288n, warehouseId: 11n, ...MINYAK, ...A1, stockCount: 1n, note: "A bottle on the floor", reportedById: ANI, reportedAtUnix: ago(7 * DAY), status: FoundRequestStatus.REJECTED, decidedById: ANI, decidedAtUnix: ago(7 * DAY - HOUR), rejectReason: "Miscounted — it was the one I moved from B-02-1", settledByCountingSessionId: 0n, posted: [], transactionId: 0n },
  { id: 290n, warehouseId: 11n, ...TEPUNG, ...A1, stockCount: 1n, note: "Fell behind the shelf", reportedById: BUDI, reportedAtUnix: ago(6 * DAY), status: FoundRequestStatus.APPROVED, decidedById: DEWI, decidedAtUnix: ago(5 * DAY), rejectReason: "", settledByCountingSessionId: 0n, posted: [{ type: FoundRequestPostType.CLAIM, batchId: 15n, stockCount: 1n, priceUnit: 15000n, problemId: 80n, problemCreatedAtUnix: ago(20 * DAY) }], transactionId: 4810n },
  { id: 301n, warehouseId: 11n, ...BERAS, ...B1, stockCount: 4n, note: "Behind the cartons on the bottom shelf, still sealed", reportedById: BUDI, reportedAtUnix: ago(2 * HOUR), ...waiting },
  { id: 302n, warehouseId: 11n, ...MINYAK, ...B1, stockCount: 1n, note: "One bottle rolled under the rack", reportedById: ANI, reportedAtUnix: ago(40 * MINUTE), ...waiting },
  { id: 303n, warehouseId: 11n, ...GULA, ...A2, stockCount: 2n, note: "Two packs on top of the rack, not in the book", reportedById: DEWI, reportedAtUnix: ago(1 * DAY), ...waiting },
];

export const foundLossFixtures: FoundLossFixture[] = [
  // Beras: two open losses — #91 is older, so it is claimed first.
  { id: 91n, warehouseId: 11n, teamId: 12n, productId: 74n, batchId: 7n, priceUnit: 62000n, claimable: 2n, claimed: 0n, createdAtUnix: ago(44 * DAY) },
  { id: 95n, warehouseId: 11n, teamId: 12n, productId: 74n, batchId: 9n, priceUnit: 65000n, claimable: 1n, claimed: 0n, createdAtUnix: ago(18 * DAY) },
  // Tepung: claimed in full by #290.
  { id: 80n, warehouseId: 11n, teamId: 15n, productId: 702n, batchId: 15n, priceUnit: 15000n, claimable: 1n, claimed: 1n, createdAtUnix: ago(20 * DAY) },
];

export const foundBatchFixtures: FoundBatchFixture[] = [
  { id: 7n, warehouseId: 11n, teamId: 12n, productId: 74n, priceUnit: 62000n },
  { id: 9n, warehouseId: 11n, teamId: 12n, productId: 74n, priceUnit: 65000n },
  { id: 11n, warehouseId: 11n, teamId: 13n, productId: 73n, priceUnit: 13000n },
  { id: 13n, warehouseId: 11n, teamId: 15n, productId: 700n, priceUnit: 31000n },
  { id: 15n, warehouseId: 11n, teamId: 15n, productId: 702n, priceUnit: 15000n },
  // The old 2L pack (790): archived by Toko Anggrek since, its batch still here — the warehouse picker offers it, labelled
  // (an-archived-product-held-here-can-be-picked).
  { id: 17n, warehouseId: 11n, teamId: 15n, productId: 790n, priceUnit: 29000n },
  // Kopi Arabika (71) has no batch here — its team never had it in Gudang Pusat.
];

export const foundLockFixtures: FoundLockFixture[] = [
  // Stock count #15 holds Gula Pasir on A-01-2 (opnameFixtures' row 1503).
  { warehouseId: 11n, productId: 73n, rackId: 42n, sessionId: 15n },
];
