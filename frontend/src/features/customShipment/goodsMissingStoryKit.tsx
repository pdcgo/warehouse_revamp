import { customShipmentClient } from "../../api/clients";
import { CustomShipmentKind, CustomShipmentPayer } from "../../gen/warehouse/inventory/v1/custom_shipment_pb";
import { goodsMissingForStory } from "../../../.storybook/customShipmentStub";
import { customShipmentScenario } from "../../../.storybook/customShipmentScenario";

// STORY-ONLY — what the #88 P6 goods-missing story files share (pages/custom-shipment-pick/stories,
// pages/custom-shipment-detail/stories, pages/custom-shipments/stories — all `GoodsMissing.stories.tsx`). Imported by
// `*.stories.tsx` only. The screens are LIVE on CustomShipmentService.CustomShipmentMissingReport and its
// `goods_missing` / trail rows; the stub (.storybook/customShipmentStub.ts) plays the server, and a story seeds the notes
// the server already holds with `seedGoodsMissing` (in its `beforeEach`, after preview.tsx reset the stub).

const BUDI = 62n; // Gudang Pusat's — picks the parcels (customShipmentFixtures.ts)
const hoursAgo = (h: number) => BigInt(Math.floor(Date.now() / 1000) - h * 3600);

/**
 * The notes a story opens with — the warehouse's notes on the fixtures' parcels:
 *   801  sample, Diminta — its 3 Beras not on A-01-1, the rack its take drew them from
 *   803  reship, Diminta — restock 512's 4 broken Kecap already thrown away (never on a rack)
 *   806  sample, cancelled after its note — the trail keeps the row, the badge is gone
 *   802  sample, picked after its note — the goods turned up: no badge either
 */
const SEEDS = {
  "801": {
    lines: [{ itemId: 80101n, rackId: 41n, quantity: 3n }],
    note: "Sudah cek A-01-1 dan rak di sebelahnya — kosong.",
    actorUserId: BUDI,
    atUnix: hoursAgo(2),
  },
  "803": {
    lines: [{ itemId: 80301n, rackId: 0n, quantity: 4n }],
    note: "Botol pecahnya sudah dibuang waktu restok diterima.",
    actorUserId: BUDI,
    atUnix: hoursAgo(3),
  },
  "806": {
    lines: [{ itemId: 80601n, rackId: 44n, rackCode: "C-01-1", quantity: 2n }],
    note: "",
    actorUserId: 0n,
  },
  "802": {
    lines: [{ itemId: 80201n, rackId: 41n, quantity: 1n }],
    note: "",
    actorUserId: BUDI,
  },
};

export type SeededParcel = keyof typeof SEEDS;

/** Seeds the named parcels' notes into the stub, in order; answers each one's trail row id by parcel. */
export function seedGoodsMissing(...parcels: SeededParcel[]): Record<string, bigint> {
  return Object.fromEntries(parcels.map((id) => [id, goodsMissingForStory(BigInt(id), SEEDS[id])]));
}

/** What the screens sent CustomShipmentMissingReport, in order — the real proto requests. */
export const goodsMissingSent = () =>
  customShipmentScenario.calls
    .filter((c) => c.rpc === "CustomShipmentMissingReport")
    .map((c) => c.req as { teamId: bigint; id: bigint; lines: { itemId: bigint; rackId: bigint; quantity: bigint }[]; note: string });

/** The goods-missing rows' test ids on the trail, oldest first (`custom-shipment-timeline-missing-<id>`). */
export const noteRowIds = (canvasElement: HTMLElement) =>
  Array.from(canvasElement.querySelectorAll("[data-kind='goods-missing']")).map((row) => row.getAttribute("data-testid")!);

/**
 * A SAMPLE WHOSE ONE LINE WAS DRAWN FROM TWO RACKS — made through the stub's real CustomShipmentCreate as Toko Melati,
 * oldest batch first, the system picking the racks: 809 takes 14 Beras (A-01-1 keeps 1), then 810's 3 Beras are drawn
 * 1 from A-01-1 and 2 from B-02-1. The dialog then prefills both racks, each with its own count. Returns 810's id.
 */
export async function aSampleOverTwoRacks(): Promise<bigint> {
  const create = (quantity: bigint, key: string) =>
    customShipmentClient.customShipmentCreate({
      teamId: 12n,
      kind: CustomShipmentKind.SAMPLE,
      warehouseId: 11n,
      lines: [{ productId: 74n, quantity }],
      recipient: { name: "Komunitas Dapur Sehat", phone: "0812-4400-1188", address: "Jl. Riau 21, Bandung 40115" },
      shipmentChannelId: 91n,
      payer: CustomShipmentPayer.WAREHOUSE,
      idempotencyKey: key,
      note: "",
    });

  await create(14n, "story-goods-missing-809");
  const res = await create(3n, "story-goods-missing-810");

  return res.customShipment!.id;
}
