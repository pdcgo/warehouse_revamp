// The stock count's fixtures (docs/business/inventory/opname.md), served by opnameStub.ts.
//
// Two warehouses, two moments of a count:
//
//   Gudang Pusat (11) — session 15, ACTIVE, plan `all`, MID-COUNT. Rak A-01-1 and A-01-2 hold rows; B-02-1 holds none,
//                       and an `all` session still lists it (an-all-count-visits-every-rack). Ani, the signed-in user,
//                       has counted nothing here, so every row is hers to count.
//   Gudang Cabang (14) — session 21, ACTIVE, plan `placement`, FULLY COUNTED by Budi and Eko — ready to finalize. Its
//                       products play the settlement decisions one each:
//                         Beras    a tear and a move: book 8, sellable 7, broken 1 → the rest 0 — broken 1 posts
//                         Minyak   short 3 across two batches → lost 2 @ 30.000 + 1 @ 32.000, oldest first
//                         Tepung   over 2 → claims the open lost #88 back into batch #29, then mints 1 at 15.000
//                         Gula     matches — left out of the preview
//
// ⚠ Rows are kept as STATE, not as the wire shape: the stub works the drafts out from the counts the way the server
// will (a-short-rack-gets-a-lost-draft-from-the-system, a-surplus-draft-is-counted-by-the-system).

import { OpnamePlan, OpnameRowStatus, OpnameSessionStatus } from "../src/gen/warehouse/inventory/v1/opname_pb";

const HOUR = 3600;
const DAY = 24 * HOUR;
const ago = (seconds: number) => BigInt(Math.floor(Date.now() / 1000) - seconds);

export interface OpnameSessionFixture {
  id: bigint;
  warehouseId: bigint;
  status: OpnameSessionStatus;
  plan: OpnamePlan;
  createdById: bigint;
  createdAtUnix: bigint;
  finalizedById: bigint;
  finalizedAtUnix: bigint;
}

export interface OpnameRowFixture {
  id: bigint;
  sessionId: bigint;
  teamId: bigint;
  productId: bigint;
  sku: string;
  name: string;
  placementId: bigint;
  placementCode: string;
  status: OpnameRowStatus;
  revealed: boolean;
  system: bigint;
  count: bigint;
  recounted: boolean;
  countedById: bigint;
  foundHere: boolean;
  broken: bigint;
  brokenNote: string;
  lostNote: string;
  surplusNote: string;
}

// A batch of a team's product in a warehouse, oldest first by `id`. `stock` is what is left; an emptied one keeps its
// price for "last price" (last-price-is-the-teams-newest-batch-here).
export interface OpnameBatchFixture {
  id: bigint;
  warehouseId: bigint;
  teamId: bigint;
  productId: bigint;
  stock: bigint;
  priceUnit: bigint;
}

// An open lost problem a surplus can claim (a-surplus-claims-the-oldest-loss-first).
export interface OpnameProblemFixture {
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

const DEWI = 64n;
const BUDI = 62n;
const EKO = 65n;

export const opnameSessionFixtures: OpnameSessionFixture[] = [
  { id: 9n, warehouseId: 11n, status: OpnameSessionStatus.FINISH, plan: OpnamePlan.ALL, createdById: DEWI, createdAtUnix: ago(45 * DAY), finalizedById: DEWI, finalizedAtUnix: ago(44 * DAY) },
  { id: 12n, warehouseId: 11n, status: OpnameSessionStatus.FINISH, plan: OpnamePlan.PRODUCT, createdById: DEWI, createdAtUnix: ago(20 * DAY), finalizedById: DEWI, finalizedAtUnix: ago(20 * DAY - 5 * HOUR) },
  { id: 13n, warehouseId: 11n, status: OpnameSessionStatus.CANCEL, plan: OpnamePlan.PLACEMENT, createdById: DEWI, createdAtUnix: ago(10 * DAY), finalizedById: 0n, finalizedAtUnix: 0n },
  { id: 15n, warehouseId: 11n, status: OpnameSessionStatus.ACTIVE, plan: OpnamePlan.ALL, createdById: DEWI, createdAtUnix: ago(1 * DAY), finalizedById: 0n, finalizedAtUnix: 0n },
  { id: 20n, warehouseId: 14n, status: OpnameSessionStatus.FINISH, plan: OpnamePlan.ALL, createdById: DEWI, createdAtUnix: ago(30 * DAY), finalizedById: DEWI, finalizedAtUnix: ago(29 * DAY) },
  { id: 21n, warehouseId: 14n, status: OpnameSessionStatus.ACTIVE, plan: OpnamePlan.PLACEMENT, createdById: DEWI, createdAtUnix: ago(3 * HOUR), finalizedById: 0n, finalizedAtUnix: 0n },
];

const BERAS = { productId: 74n, teamId: 12n, sku: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg" };
const GULA = { productId: 73n, teamId: 13n, sku: "SKU-GULA-1K", name: "Gula Pasir 1kg" };
const MINYAK = { productId: 700n, teamId: 15n, sku: "SKU-ANG-001", name: "Minyak Goreng Sawit 2L — Satuan" };
const MINYAK_KARTON = { productId: 701n, teamId: 15n, sku: "SKU-ANG-002", name: "Minyak Goreng Sawit 2L — Karton" };
const TEPUNG = { productId: 702n, teamId: 15n, sku: "SKU-ANG-003", name: "Tepung Terigu Serbaguna 1kg — Satuan" };

const A1 = { placementId: 41n, placementCode: "A-01-1" };
const A2 = { placementId: 42n, placementCode: "A-01-2" };
const C1 = { placementId: 44n, placementCode: "C-01-1" };
const C2 = { placementId: 45n, placementCode: "C-01-2" };

const blank = {
  status: OpnameRowStatus.CREATED,
  revealed: false,
  count: 0n,
  recounted: false,
  countedById: 0n,
  foundHere: false,
  broken: 0n,
  brokenNote: "",
  lostNote: "",
  surplusNote: "",
};

const counted = (by: bigint) => ({ ...blank, status: OpnameRowStatus.COUNTED, revealed: true, countedById: by });

export const opnameRowFixtures: OpnameRowFixture[] = [
  // ── Session 15, Gudang Pusat — mid-count ──────────────────────────────────────────────────────────────────────────
  // Beras: a tear on A-01-1 and a unit moved to A-01-2 — counted, both.
  { id: 1501n, sessionId: 15n, ...BERAS, ...A1, ...counted(BUDI), system: 5n, count: 3n, broken: 1n, brokenNote: "Karung sobek, dibuang", lostNote: "Tidak ketemu, sudah cek bawah rak" },
  { id: 1502n, sessionId: 15n, ...BERAS, ...A2, ...counted(BUDI), system: 3n, count: 4n, surplusNote: "Terselip di belakang Gula Pasir" },
  { id: 1503n, sessionId: 15n, ...GULA, ...A2, ...counted(EKO), system: 12n, count: 12n },
  // Not counted yet — Ani's to count.
  { id: 1504n, sessionId: 15n, ...MINYAK, ...A1, ...blank, system: 6n },
  // Counted blind by Eko and revealed SHORT 2 — the lost draft is the system's; the reasons are not typed yet.
  { id: 1505n, sessionId: 15n, ...TEPUNG, ...A1, ...blank, revealed: true, countedById: EKO, system: 4n, count: 2n },
  // A ROW AT 0 (a-snapshot-includes-rows-at-zero): the book says none here; a wrong-rack pick may have left one.
  { id: 1506n, sessionId: 15n, ...MINYAK_KARTON, ...A2, ...blank, system: 0n },

  // ── Session 12, finished — two rows, for the list's progress ──────────────────────────────────────────────────────
  { id: 1201n, sessionId: 12n, ...GULA, ...A2, ...counted(EKO), system: 14n, count: 14n },
  { id: 1202n, sessionId: 12n, ...GULA, ...A1, ...counted(EKO), system: 2n, count: 1n, lostNote: "Tidak ketemu" },
  // ── Session 13, cancelled ─────────────────────────────────────────────────────────────────────────────────────────
  { id: 1301n, sessionId: 13n, ...BERAS, ...A1, ...blank, system: 6n },
  // ── Session 9, finished ───────────────────────────────────────────────────────────────────────────────────────────
  { id: 901n, sessionId: 9n, ...BERAS, ...A1, ...counted(BUDI), system: 4n, count: 4n },
  // ── Session 20, finished (Gudang Cabang) ──────────────────────────────────────────────────────────────────────────
  { id: 2001n, sessionId: 20n, ...MINYAK, ...C1, ...counted(BUDI), system: 12n, count: 12n },

  // ── Session 21, Gudang Cabang — fully counted, ready to finalize ──────────────────────────────────────────────────
  { id: 2101n, sessionId: 21n, ...BERAS, ...C1, ...counted(BUDI), system: 5n, count: 3n, broken: 1n, brokenNote: "Karung sobek, dibuang", lostNote: "Tidak ketemu" },
  { id: 2102n, sessionId: 21n, ...BERAS, ...C2, ...counted(BUDI), system: 3n, count: 4n, surplusNote: "Terselip di rak belakang" },
  { id: 2103n, sessionId: 21n, ...MINYAK, ...C1, ...counted(EKO), system: 10n, count: 7n, lostNote: "Tidak ketemu, sudah cek seluruh lorong" },
  { id: 2104n, sessionId: 21n, ...TEPUNG, ...C2, ...counted(EKO), system: 4n, count: 6n, surplusNote: "Ketemu di gudang belakang" },
  { id: 2105n, sessionId: 21n, ...GULA, ...C2, ...counted(EKO), system: 12n, count: 12n },
];

export const opnameBatchFixtures: OpnameBatchFixture[] = [
  // Gudang Pusat
  { id: 7n, warehouseId: 11n, ...pick(BERAS), stock: 5n, priceUnit: 62000n },
  { id: 9n, warehouseId: 11n, ...pick(BERAS), stock: 3n, priceUnit: 65000n },
  { id: 11n, warehouseId: 11n, ...pick(GULA), stock: 12n, priceUnit: 13000n },
  { id: 13n, warehouseId: 11n, ...pick(MINYAK), stock: 6n, priceUnit: 31000n },
  { id: 14n, warehouseId: 11n, ...pick(MINYAK_KARTON), stock: 0n, priceUnit: 360000n },
  { id: 15n, warehouseId: 11n, ...pick(TEPUNG), stock: 4n, priceUnit: 15000n },
  // Tepung Karton (703) has a batch here, so it may be added as found; Gula Merah (704, 705) has none anywhere here — its
  // team never had it in Gudang Pusat (a-unit-never-stocked-here-comes-in-by-restock).
  { id: 16n, warehouseId: 11n, teamId: 15n, productId: 703n, stock: 0n, priceUnit: 150000n },
  // Gudang Cabang
  { id: 29n, warehouseId: 14n, ...pick(TEPUNG), stock: 0n, priceUnit: 14000n },
  { id: 31n, warehouseId: 14n, ...pick(MINYAK), stock: 2n, priceUnit: 30000n },
  { id: 33n, warehouseId: 14n, ...pick(TEPUNG), stock: 4n, priceUnit: 15000n },
  { id: 34n, warehouseId: 14n, ...pick(MINYAK), stock: 8n, priceUnit: 32000n },
  { id: 40n, warehouseId: 14n, ...pick(GULA), stock: 12n, priceUnit: 13000n },
  { id: 51n, warehouseId: 14n, ...pick(BERAS), stock: 4n, priceUnit: 62000n },
  { id: 55n, warehouseId: 14n, ...pick(BERAS), stock: 4n, priceUnit: 65000n },
];

export const opnameProblemFixtures: OpnameProblemFixture[] = [
  // Lost at an earlier count, still claimable — Tepung's surplus at Gudang Cabang claims it back first.
  { id: 88n, warehouseId: 14n, teamId: 15n, productId: 702n, batchId: 29n, priceUnit: 14000n, claimable: 1n, claimed: 0n, createdAtUnix: ago(29 * DAY) },
];

function pick(p: { productId: bigint; teamId: bigint }) {
  return { productId: p.productId, teamId: p.teamId };
}
