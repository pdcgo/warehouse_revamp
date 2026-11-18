import type { RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { brokenQuantity } from "./summary";

// ⚠ A SAMPLE — where the broken units' rack WILL read on the warehouse's detail page, before anything keeps it. The accept
// page lets a rack be chosen and keeps none; so the page shows where it will sit, with this, and says it is a sample
// (`brokenRack` in its pending list). The day the restock carries it, this file goes and the page reads the restock's own.
//
// The door's two PHOTOS were samples here too — a drawn torn carton and a drawn slip — until Terima kept them
// (the-detail-pages-show-the-broken-photo, the-detail-pages-show-the-slip-and-the-broken-rack): the pages read the
// restock's own through RestockDoorPhotos now. The drawings live on as Storybook's fixtures (.storybook/doorPhotoStub.ts).

/**
 * The rack a line's broken units were put on — the sample is the line's first placement's code, on a line with broken
 * units; "" otherwise. A real code of this warehouse, so the cell reads as it will — and marked, so nobody believes it.
 */
export function brokenRackSample(item: RestockRequestItem, codes: Record<string, string>): string {
  if (brokenQuantity(item) <= 0n) return "";
  const first = item.placements[0];

  return first ? (codes[first.placementId.toString()] ?? "") : "";
}
