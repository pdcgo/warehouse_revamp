import { create } from "@bufbuild/protobuf";

import { restockRequestService, restockWire } from "../../../.storybook/restockStub";
import { RestockRequestSchema } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// STORY-ONLY helper for the restock feature components — a fixture restock as a real message. Imported by
// `*.stories.tsx` only.
export const storyRestock = (id: bigint) => create(RestockRequestSchema, restockWire(id));

/**
 * Restock `id` signed for by its warehouse, Gudang Pusat (11), with the courier's charge noted at the door — through the
 * stub's own Arrive, as the sign dialog sends it (the-courier-charge-is-noted-at-tiba-and-final-at-terima). For a story's
 * `beforeEach`, after preview's reset; the next story's reset puts it back.
 */
export async function signedForWithAChargeForStory(id: bigint, charge = 15000, note = "Biaya COD", slip = "") {
  await restockRequestService.restockRequestArrive!(
    {
      teamId: 11n,
      requestId: id,
      warehouseAdditionalCost: charge,
      warehouseAdditionalCostNote: note,
      warehouseAdditionalCostFile: slip,
    } as never,
    {} as never,
  );
}

/** Restock `id` as the stub holds it now, read as its warehouse (11) — what a sign or a Terima left on it. */
export async function storedRestockForStory(id: bigint) {
  return (await restockRequestService.restockRequestDetail!({ teamId: 11n, requestId: id } as never, {} as never)).request!;
}
