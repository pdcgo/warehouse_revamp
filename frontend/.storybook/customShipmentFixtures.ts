import {
  CustomShipmentKind as K,
  CustomShipmentLogKind as LK,
  CustomShipmentPayer as P,
  CustomShipmentStatus as S,
} from "../src/gen/warehouse/inventory/v1/custom_shipment_pb";
import { daysAgo } from "./fixtures";
import { restockFixtures } from "./restockFixtures";

// THE CUSTOM SHIPMENTS' STUB DATA (backlog #88) — the rows customShipmentStub.ts serves through the REAL proto
// (proto/warehouse/inventory/v1/custom_shipment.proto). These are the SERVER's rows, money and all: the stub leaves the
// seller's money unset when a warehouse reads them, as customShipmentToProto does. The prototype's parcels, kept as they
// were accepted, so every story still reads the same figures.
//
//   id   team           kind     status       from          what                          courier   who pays
//   801  Toko Melati    sample   requested    Gudang Pusat  Beras ×3 (A-01-1)             JNE       warehouse
//   802  Toko Melati    sample   picked       Gudang Pusat  Beras ×2, Tepung ×4           SiCepat   team — BCA Operasional, Rp 18.000
//   803  Toko Melati    reship   requested    Gudang Pusat  Kecap ×4 broken (restock 512) J&T       warehouse — to CV Cahaya Abadi
//   804  Toko Melati    sample   handed over  Gudang Pusat  Beras ×1                      JNE       warehouse — paid Rp 12.000
//   805  Toko Melati    reship   handed over  Gudang Pusat  Gula ×2 broken (restock 510)  JNE       team — Rp 22.000 (edited from 0)
//   806  Toko Melati    sample   cancelled    Gudang Cabang Beras ×2 (C-01-1)             J&T       team — Kas Melati, no cost yet
//   807  Toko Kenanga   sample   requested    Gudang Pusat  Gula ×5                       SiCepat   warehouse — another team's: only
//                                                                                                   Gudang Pusat sees it
//   808  Toko Melati    sample   picked       Gudang Pusat  Beras ×5 (A-01-1)             JNE       warehouse — the handover's cost
//
// THE RESHIP OPTIONS — Toko Melati's received restocks with broken units; `already_sent` is worked out live from the
// parcels above (a reship that is not cancelled carries its units), as the server's `reshipUnitsSent`:
//   503  (restockFixtures — 2 broken Beras, "Karung sobek")  supplier 31 PT Sumber Makmur (contact AND address kept),
//        store 312 Sumber Makmur Store
//   512  (this file's)  Kecap ×6 broken, 4 already on 803 — supplier 32 CV Cahaya Abadi (all three facts)
//                       Tepung ×3 broken — supplier 33 Toko Grosir Sinar, which keeps NO contact and NO address
//        two suppliers on one restock: the form asks which one this parcel goes to.

const WH_PUSAT = 11n;
const WH_CABANG = 14n;
const MELATI = 12n;
const KENANGA = 13n;
const EKO = 65n; // Toko Melati's — asks for the parcels
const BUDI = 62n; // Gudang Pusat's — picks and hands over
const JNE = 91n;
const JNT = 92n;
const SICEPAT = 93n;
const BCA_OPS = 1301n;
const KAS_MELATI = 1309n;

/** A sample's take — its inventory transaction, as the parcel keeps it (StockPickLocations reads its racks). */
export const PARCEL_TX_BASE = 95_000n;
export const parcelTransactionOf = (id: bigint) => PARCEL_TX_BASE + id;

export const PRODUCT = {
  beras: { productId: 74n, productCode: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg" },
  tepung: { productId: 75n, productCode: "SKU-TEPUNG-1K", name: "Tepung Terigu 1kg" },
  kecap: { productId: 76n, productCode: "SKU-KECAP-600", name: "Kecap Manis 600ml" },
  gula: { productId: 73n, productCode: "SKU-GULA-1K", name: "Gula Pasir 1kg" },
} as const;

/** What a unit is worth at its batch — a sample line's value (a-sample-is-a-stock-out-at-batch-value). */
export const UNIT_VALUE: Record<string, number> = { "74": 65_000, "75": 12_000, "76": 18_000, "73": 16_000 };

export interface ParcelItemRow {
  id: bigint;
  productId: bigint;
  productCode: string;
  name: string;
  quantity: bigint;
  total: number;
  restockItemId: bigint;
  brokenNote: string;
}

/** One line of a goods-missing note as the server keeps it (custom_shipment_missing_lines, read with its product and rack). */
export interface ParcelMissingRow {
  itemId: bigint;
  productId: bigint;
  productCode: string;
  name: string;
  rackId: bigint;
  rackCode: string;
  quantity: bigint;
}

export interface ParcelLogRow {
  id: bigint;
  /** STATUS (the create or a move), COST_EDIT (from = to) or GOODS_MISSING (the warehouse's note, backlog #88 P6). */
  kind: LK;
  fromStatus: S;
  toStatus: S;
  actorUserId: bigint;
  atUnix: bigint;
  isOverride: boolean;
  description: string;
  /** A GOODS_MISSING row's lines; [] on any other. */
  missing: ParcelMissingRow[];
}

/** Where a sample's take drew its units — what StockPickLocations answers for its transaction. */
export interface ParcelPickRow {
  productId: bigint;
  rackId: bigint;
  rackCode: string;
  quantity: bigint;
}

/** One `custom_shipments` row as the server keeps it — the reader's view is cut from it by the stub. */
export interface ParcelRow {
  id: bigint;
  teamId: bigint;
  warehouseId: bigint;
  kind: K;
  status: S;
  restockId: bigint;
  supplierId: bigint;
  recipient: { name: string; phone: string; address: string };
  shipmentChannelId: bigint;
  payer: P;
  financeAccountId: bigint;
  shippingCost: number;
  resi: string;
  note: string;
  items: ParcelItemRow[];
  transactionId: bigint;
  total: number;
  logs: ParcelLogRow[];
  createdByUserId: bigint;
  createdAtUnix: bigint;
  pickedByUserId: bigint;
  pickedAtUnix: bigint;
  handedOverByUserId: bigint;
  handedOverAtUnix: bigint;
  cancelledByUserId: bigint;
  cancelledAtUnix: bigint;
  idempotencyKey: string;
  /** The take's racks — the server's placement logs, read back by StockPickLocations. */
  picks: ParcelPickRow[];
}

type Product = (typeof PRODUCT)[keyof typeof PRODUCT];

const item = (shipmentId: bigint, n: number, product: Product, quantity: number, reship?: { restockItemId: bigint; brokenNote: string }): ParcelItemRow => ({
  id: shipmentId * 100n + BigInt(n),
  ...product,
  quantity: BigInt(quantity),
  total: reship ? 0 : quantity * (UNIT_VALUE[product.productId.toString()] ?? 0),
  restockItemId: reship?.restockItemId ?? 0n,
  brokenNote: reship?.brokenNote ?? "",
});

const pick = (productId: bigint, rackId: bigint, rackCode: string, quantity: number): ParcelPickRow => ({
  productId,
  rackId,
  rackCode,
  quantity: BigInt(quantity),
});

let logSeq = 0n;
const step = (from: S, to: S, actorUserId: bigint, daysBack: number, description = ""): ParcelLogRow => {
  logSeq += 1n;
  // A few minutes apart inside a day, so a trail's rows on one day keep their order.
  return {
    id: logSeq,
    kind: from === to ? LK.COST_EDIT : LK.STATUS,
    fromStatus: from,
    toStatus: to,
    actorUserId,
    atUnix: daysAgo(daysBack) + logSeq * 60n,
    isOverride: false,
    description,
    missing: [],
  };
};

function parcel(fields: Partial<ParcelRow> & Pick<ParcelRow, "id" | "kind" | "status" | "items" | "recipient" | "logs">): ParcelRow {
  const at = (to: S) => fields.logs.find((l) => l.toStatus === to && l.fromStatus !== to);

  return {
    teamId: MELATI,
    warehouseId: WH_PUSAT,
    restockId: 0n,
    supplierId: 0n,
    shipmentChannelId: JNE,
    payer: P.WAREHOUSE,
    financeAccountId: 0n,
    shippingCost: 0,
    resi: "",
    note: "",
    transactionId: fields.kind === K.SAMPLE ? parcelTransactionOf(fields.id) : 0n,
    total: fields.items.reduce((sum, i) => sum + i.total, 0),
    createdByUserId: EKO,
    createdAtUnix: fields.logs[0]!.atUnix,
    pickedByUserId: at(S.PICKED)?.actorUserId ?? 0n,
    pickedAtUnix: at(S.PICKED)?.atUnix ?? 0n,
    handedOverByUserId: at(S.HANDED_OVER)?.actorUserId ?? 0n,
    handedOverAtUnix: at(S.HANDED_OVER)?.atUnix ?? 0n,
    cancelledByUserId: at(S.CANCELLED)?.actorUserId ?? 0n,
    cancelledAtUnix: at(S.CANCELLED)?.atUnix ?? 0n,
    idempotencyKey: `fixture-${fields.id}`,
    picks: [],
    ...fields,
  };
}

const NONE = S.UNSPECIFIED;

export function customShipmentRows(): ParcelRow[] {
  logSeq = 0n;

  return [
    parcel({
      id: 801n,
      kind: K.SAMPLE,
      status: S.REQUESTED,
      items: [item(801n, 1, PRODUCT.beras, 3)],
      picks: [pick(74n, 41n, "A-01-1", 3)],
      recipient: { name: "Rina Kusuma", phone: "0812-7777-1010", address: "Jl. Cihampelas 88, Coblong, Bandung 40131" },
      note: "Untuk video ulasan — bungkus rapi, kirim hari ini.",
      logs: [step(NONE, S.REQUESTED, EKO, 1)],
    }),
    parcel({
      id: 802n,
      kind: K.SAMPLE,
      status: S.PICKED,
      items: [item(802n, 1, PRODUCT.beras, 2), item(802n, 2, PRODUCT.tepung, 4)],
      picks: [pick(74n, 41n, "A-01-1", 2), pick(75n, 42n, "A-01-2", 4)],
      recipient: { name: "Pak Hendra — Komunitas Baking", phone: "0813-2020-3030", address: "Jl. Gatot Subroto 5, Cimahi 40512" },
      shipmentChannelId: SICEPAT,
      payer: P.TEAM,
      financeAccountId: BCA_OPS,
      shippingCost: 18_000,
      logs: [step(NONE, S.REQUESTED, EKO, 2), step(S.REQUESTED, S.PICKED, BUDI, 1)],
    }),
    parcel({
      id: 803n,
      kind: K.RESTOCK_RESHIP,
      status: S.REQUESTED,
      restockId: 512n,
      supplierId: 32n,
      items: [item(803n, 1, PRODUCT.kecap, 4, { restockItemId: 5121n, brokenNote: "Botol pecah" })],
      recipient: { name: "CV Cahaya Abadi", phone: "0812-2222-3333", address: "Jl. Raya Darmo 45, Surabaya" },
      shipmentChannelId: JNT,
      logs: [step(NONE, S.REQUESTED, EKO, 1)],
    }),
    parcel({
      id: 804n,
      kind: K.SAMPLE,
      status: S.HANDED_OVER,
      items: [item(804n, 1, PRODUCT.beras, 1)],
      picks: [pick(74n, 41n, "A-01-1", 1)],
      recipient: { name: "Bu Sari — Reseller Cimahi", phone: "0821-4545-6767", address: "Jl. Kebon Kopi 17, Cibeureum, Cimahi 40535" },
      shippingCost: 12_000,
      resi: "JNE0098123456",
      logs: [step(NONE, S.REQUESTED, EKO, 5), step(S.REQUESTED, S.PICKED, BUDI, 4), step(S.PICKED, S.HANDED_OVER, BUDI, 4)],
    }),
    parcel({
      id: 805n,
      kind: K.RESTOCK_RESHIP,
      status: S.HANDED_OVER,
      restockId: 510n,
      supplierId: 35n,
      items: [item(805n, 1, PRODUCT.gula, 2, { restockItemId: 5101n, brokenNote: "Karung bocor" })],
      recipient: { name: "PT Banyak Toko", phone: "0811-5555-6666", address: "Jl. Gatot Subroto 20, Jakarta" },
      payer: P.TEAM,
      financeAccountId: BCA_OPS,
      shippingCost: 22_000,
      resi: "JNE0098124001",
      logs: [
        step(NONE, S.REQUESTED, EKO, 8),
        step(S.REQUESTED, S.PICKED, BUDI, 7),
        step(S.PICKED, S.PICKED, EKO, 7, "Rp 0 → Rp 22.000"),
        step(S.PICKED, S.HANDED_OVER, BUDI, 7),
      ],
    }),
    parcel({
      id: 806n,
      kind: K.SAMPLE,
      status: S.CANCELLED,
      warehouseId: WH_CABANG,
      items: [item(806n, 1, PRODUCT.beras, 2)],
      recipient: { name: "Dewi Anggraini", phone: "0857-1212-3434", address: "Jl. Pahlawan 3, Semarang 50241" },
      shipmentChannelId: JNT,
      payer: P.TEAM,
      financeAccountId: KAS_MELATI,
      logs: [step(NONE, S.REQUESTED, EKO, 10), step(S.REQUESTED, S.CANCELLED, EKO, 10)],
    }),
    parcel({
      id: 807n,
      teamId: KENANGA,
      kind: K.SAMPLE,
      status: S.REQUESTED,
      items: [item(807n, 1, PRODUCT.gula, 5)],
      picks: [pick(73n, 42n, "A-01-2", 5)],
      recipient: { name: "Pak Joko", phone: "0813-9999-0001", address: "Jl. Asia Afrika 1, Bandung 40111" },
      shipmentChannelId: SICEPAT,
      createdByUserId: 61n,
      logs: [step(NONE, S.REQUESTED, 61n, 2)],
    }),
    parcel({
      id: 808n,
      kind: K.SAMPLE,
      status: S.PICKED,
      items: [item(808n, 1, PRODUCT.beras, 5)],
      picks: [pick(74n, 41n, "A-01-1", 5)],
      recipient: { name: "Dimas Pratama", phone: "0812-8080-9090", address: "Jl. Dago 120, Coblong, Bandung 40135" },
      logs: [step(NONE, S.REQUESTED, EKO, 3), step(S.REQUESTED, S.PICKED, BUDI, 0)],
    }),
  ];
}

/** One broken line of a received restock as the server keeps it — `already_sent` is the stub's to work out. */
export interface ReshipLineRow {
  restockItemId: bigint;
  productId: bigint;
  productCode: string;
  name: string;
  broken: bigint;
  brokenNote: string;
  supplierId: bigint;
  supplierChannelId: bigint;
}

export interface ReshipRestockRow {
  restockId: bigint;
  teamId: bigint;
  warehouseId: bigint;
  acceptedAtUnix: bigint;
  lines: ReshipLineRow[];
}

export function reshipRestockRows(): ReshipRestockRow[] {
  const r503 = restockFixtures.find((r) => r.id === 503n)!;
  const beras = r503.items.find((i) => i.productId === 74n)!;
  const broken = beras.problems.find((p) => p.count > 0n && p.note === "Karung sobek")!;

  return [
    {
      restockId: 503n,
      teamId: r503.requestingTeamId,
      warehouseId: r503.warehouseId,
      acceptedAtUnix: r503.acceptedAtUnix,
      lines: [
        {
          restockItemId: beras.id,
          ...PRODUCT.beras,
          broken: broken.count,
          brokenNote: broken.note,
          supplierId: beras.supplierId,
          supplierChannelId: beras.supplierChannelId,
        },
      ],
    },
    {
      restockId: 512n,
      teamId: MELATI,
      warehouseId: WH_PUSAT,
      acceptedAtUnix: daysAgo(3),
      lines: [
        { restockItemId: 5121n, ...PRODUCT.kecap, broken: 6n, brokenNote: "Botol pecah", supplierId: 32n, supplierChannelId: 0n },
        { restockItemId: 5122n, ...PRODUCT.tepung, broken: 3n, brokenNote: "Kemasan basah", supplierId: 33n, supplierChannelId: 0n },
      ],
    },
  ];
}

/**
 * What the racks hold NOW of each team's product, oldest batch first — what a sample's take draws, keyed
 * `${warehouseId}:${productId}`. Gudang Pusat's 25 Beras are the 25 the availability stub answers (fixtures.ts
 * warehouseStock).
 */
export function parcelShelves(): Record<string, ParcelPickRow[]> {
  return {
    "11:74": [
      { productId: 74n, rackId: 41n, rackCode: "A-01-1", quantity: 15n },
      { productId: 74n, rackId: 43n, rackCode: "B-02-1", quantity: 10n },
    ],
    "14:74": [{ productId: 74n, rackId: 44n, rackCode: "C-01-1", quantity: 6n }],
  };
}
