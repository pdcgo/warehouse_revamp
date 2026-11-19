import type {
  CustomShipment,
  CustomShipmentItem,
  CustomShipmentLog,
  CustomShipmentPick,
  ReshipOption,
  ReshipSupplier,
} from "../src/features/customShipment/customShipments";
import type { CustomShipmentsAnswer } from "../src/features/customShipment/customShipmentPrototype";
import { daysAgo } from "./fixtures";
import { restockFixtures } from "./restockFixtures";
import { supplierFixtures } from "./supplierFixtures";

// THE CUSTOM SHIPMENTS' STUB DATA (backlog #88, PROTOTYPE) — shaped as the ASSUMED API written at the head of
// src/features/customShipment/customShipments.ts (CustomShipment, CustomShipmentItem, CustomShipmentLog, the reship
// options). Nothing here is served by the stub transport (the proto has none of it): the prototype provider plays the
// server in memory, seeded from `customShipmentAnswer()`. Every OTHER read the screens make — teams, couriers, accounts,
// people, the stock a sample may take, the products picker — is the real stub's, from the shared fixtures.
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
// THE REship OPTIONS — Toko Melati's Diterima restocks carrying *Barang rusak*:
//   503  (restockFixtures — 2 broken Beras, "Karung sobek")  supplier PT Sumber Makmur: name, contact AND address kept
//   512  (this file's)  Kecap ×6 broken, 4 already on 803 — CV Cahaya Abadi (all three facts)
//                       Tepung ×3 broken — Toko Grosir Sinar, which keeps NO contact and NO address (supplierFixtures 33)
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

const PRODUCT = {
  beras: { productId: 74n, productCode: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg" },
  tepung: { productId: 75n, productCode: "SKU-TEPUNG-1K", name: "Tepung Terigu 1kg" },
  kecap: { productId: 76n, productCode: "SKU-KECAP-600", name: "Kecap Manis 600ml" },
  gula: { productId: 73n, productCode: "SKU-GULA-1K", name: "Gula Pasir 1kg" },
} as const;

/** What a unit is worth at its batch — a sample line's value (a-sample-is-a-stock-out-at-batch-value). */
const UNIT_VALUE: Record<string, number> = { "74": 65_000, "75": 12_000, "76": 18_000, "73": 16_000 };

const item = (
  shipmentId: bigint,
  n: number,
  product: (typeof PRODUCT)[keyof typeof PRODUCT],
  quantity: number,
  reship?: { restockItemId: bigint; brokenNote: string },
): CustomShipmentItem => ({
  id: shipmentId * 100n + BigInt(n),
  ...product,
  quantity: BigInt(quantity),
  total: reship ? 0 : quantity * (UNIT_VALUE[product.productId.toString()] ?? 0),
  restockItemId: reship?.restockItemId ?? 0n,
  brokenNote: reship?.brokenNote ?? "",
});

const pick = (productId: bigint, rackId: bigint, rackCode: string, quantity: number): CustomShipmentPick => ({
  productId,
  rackId,
  rackCode,
  quantity: BigInt(quantity),
});

let logSeq = 0n;
const step = (
  from: CustomShipmentLog["fromStatus"],
  to: CustomShipmentLog["toStatus"],
  actorUserId: bigint,
  daysBack: number,
  description = "",
): CustomShipmentLog => {
  logSeq += 1n;
  // A few minutes apart inside a day, so a trail's rows on one day keep their order.
  return { id: logSeq, fromStatus: from, toStatus: to, actorUserId, atUnix: daysAgo(daysBack) + logSeq * 60n, isOverride: false, description };
};

function shipment(
  fields: Partial<CustomShipment> & Pick<CustomShipment, "id" | "kind" | "status" | "items" | "recipient" | "logs">,
): CustomShipment {
  const items = fields.items;

  return {
    teamId: MELATI,
    warehouseId: WH_PUSAT,
    restockId: 0n,
    supplierId: 0n,
    shipmentChannelId: JNE,
    payer: "WAREHOUSE",
    financeAccountId: 0n,
    shippingCost: 0,
    resi: "",
    note: "",
    picks: [],
    total: items.reduce((sum, i) => sum + i.total, 0),
    createdByUserId: EKO,
    createdAtUnix: fields.logs[0]!.atUnix,
    ...fields,
  };
}

function supplierOf(id: bigint): ReshipSupplier {
  const found = supplierFixtures.find((s) => s.id === id)!;

  return { id: found.id, name: found.name, contact: found.contact, address: found.address };
}

export function customShipmentFixtures(): CustomShipment[] {
  logSeq = 0n;

  return [
    shipment({
      id: 801n,
      kind: "SAMPLE",
      status: "REQUESTED",
      items: [item(801n, 1, PRODUCT.beras, 3)],
      picks: [pick(74n, 41n, "A-01-1", 3)],
      recipient: { name: "Rina Kusuma", phone: "0812-7777-1010", address: "Jl. Cihampelas 88, Coblong, Bandung 40131" },
      note: "Untuk video ulasan — bungkus rapi, kirim hari ini.",
      logs: [step("NONE", "REQUESTED", EKO, 1)],
    }),
    shipment({
      id: 802n,
      kind: "SAMPLE",
      status: "PICKED",
      items: [item(802n, 1, PRODUCT.beras, 2), item(802n, 2, PRODUCT.tepung, 4)],
      picks: [pick(74n, 41n, "A-01-1", 2), pick(75n, 42n, "A-01-2", 4)],
      recipient: { name: "Pak Hendra — Komunitas Baking", phone: "0813-2020-3030", address: "Jl. Gatot Subroto 5, Cimahi 40512" },
      shipmentChannelId: SICEPAT,
      payer: "TEAM",
      financeAccountId: BCA_OPS,
      shippingCost: 18_000,
      logs: [step("NONE", "REQUESTED", EKO, 2), step("REQUESTED", "PICKED", BUDI, 1)],
    }),
    shipment({
      id: 803n,
      kind: "RESTOCK_RESHIP",
      status: "REQUESTED",
      restockId: 512n,
      supplierId: 32n,
      items: [item(803n, 1, PRODUCT.kecap, 4, { restockItemId: 5121n, brokenNote: "Botol pecah" })],
      recipient: { name: "CV Cahaya Abadi", phone: "0812-2222-3333", address: "Jl. Raya Darmo 45, Surabaya" },
      shipmentChannelId: JNT,
      logs: [step("NONE", "REQUESTED", EKO, 1)],
    }),
    shipment({
      id: 804n,
      kind: "SAMPLE",
      status: "HANDED_OVER",
      items: [item(804n, 1, PRODUCT.beras, 1)],
      picks: [pick(74n, 41n, "A-01-1", 1)],
      recipient: { name: "Bu Sari — Reseller Cimahi", phone: "0821-4545-6767", address: "Jl. Kebon Kopi 17, Cibeureum, Cimahi 40535" },
      shippingCost: 12_000,
      resi: "JNE0098123456",
      logs: [step("NONE", "REQUESTED", EKO, 5), step("REQUESTED", "PICKED", BUDI, 4), step("PICKED", "HANDED_OVER", BUDI, 4)],
    }),
    shipment({
      id: 805n,
      kind: "RESTOCK_RESHIP",
      status: "HANDED_OVER",
      restockId: 510n,
      supplierId: 35n,
      items: [item(805n, 1, PRODUCT.gula, 2, { restockItemId: 5101n, brokenNote: "Karung bocor" })],
      recipient: { name: "PT Banyak Toko", phone: "0811-5555-6666", address: "Jl. Gatot Subroto 20, Jakarta" },
      payer: "TEAM",
      financeAccountId: BCA_OPS,
      shippingCost: 22_000,
      resi: "JNE0098124001",
      logs: [
        step("NONE", "REQUESTED", EKO, 8),
        step("REQUESTED", "PICKED", BUDI, 7),
        step("PICKED", "PICKED", EKO, 7, "Rp 0 → Rp 22.000"),
        step("PICKED", "HANDED_OVER", BUDI, 7),
      ],
    }),
    shipment({
      id: 806n,
      kind: "SAMPLE",
      status: "CANCELLED",
      warehouseId: WH_CABANG,
      items: [item(806n, 1, PRODUCT.beras, 2)],
      recipient: { name: "Dewi Anggraini", phone: "0857-1212-3434", address: "Jl. Pahlawan 3, Semarang 50241" },
      shipmentChannelId: JNT,
      payer: "TEAM",
      financeAccountId: KAS_MELATI,
      logs: [step("NONE", "REQUESTED", EKO, 10), step("REQUESTED", "CANCELLED", EKO, 10)],
    }),
    shipment({
      id: 807n,
      teamId: KENANGA,
      kind: "SAMPLE",
      status: "REQUESTED",
      items: [item(807n, 1, PRODUCT.gula, 5)],
      picks: [pick(73n, 42n, "A-01-2", 5)],
      recipient: { name: "Pak Joko", phone: "0813-9999-0001", address: "Jl. Asia Afrika 1, Bandung 40111" },
      shipmentChannelId: SICEPAT,
      createdByUserId: 61n,
      logs: [step("NONE", "REQUESTED", 61n, 2)],
    }),
    shipment({
      id: 808n,
      kind: "SAMPLE",
      status: "PICKED",
      items: [item(808n, 1, PRODUCT.beras, 5)],
      picks: [pick(74n, 41n, "A-01-1", 5)],
      recipient: { name: "Dimas Pratama", phone: "0812-8080-9090", address: "Jl. Dago 120, Coblong, Bandung 40135" },
      logs: [step("NONE", "REQUESTED", EKO, 3), step("REQUESTED", "PICKED", BUDI, 0)],
    }),
  ];
}

export function reshipOptionFixtures(): ReshipOption[] {
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
          alreadySent: 0n,
          brokenNote: broken.note,
          supplier: supplierOf(31n),
          storeName: "Sumber Makmur Store",
        },
      ],
    },
    {
      restockId: 512n,
      teamId: MELATI,
      warehouseId: WH_PUSAT,
      acceptedAtUnix: daysAgo(3),
      lines: [
        { restockItemId: 5121n, ...PRODUCT.kecap, broken: 6n, alreadySent: 4n, brokenNote: "Botol pecah", supplier: supplierOf(32n), storeName: "" },
        { restockItemId: 5122n, ...PRODUCT.tepung, broken: 3n, alreadySent: 0n, brokenNote: "Kemasan basah", supplier: supplierOf(33n), storeName: "" },
      ],
    },
  ];
}

/** The provider's seed — a fresh copy per story. */
export function customShipmentAnswer(): CustomShipmentsAnswer {
  return {
    shipments: customShipmentFixtures(),
    reshipOptions: reshipOptionFixtures(),
    // What the racks hold NOW of each team's product, oldest batch first — Gudang Pusat's 25 Beras are the 25 the
    // availability stub answers (fixtures.ts warehouseStock).
    shelves: {
      "11:74": [
        { rackId: 41n, rackCode: "A-01-1", quantity: 15n },
        { rackId: 43n, rackCode: "B-02-1", quantity: 10n },
      ],
      "14:74": [{ rackId: 44n, rackCode: "C-01-1", quantity: 6n }],
    },
    unitValue: UNIT_VALUE,
  };
}
