import { create } from "@bufbuild/protobuf";

import { transferWire } from "../../../.storybook/warehouseTransferStub";
import { WarehouseTransferSchema } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import type { PendingList } from "../pending/registry";

// STORY-ONLY helpers for the warehouse transfer feature components — a fixture transfer as a real message, and a
// pending list carrying every id the action components look up. Imported by `*.stories.tsx` only.
export const storyTransfer = (id: bigint) => create(WarehouseTransferSchema, transferWire(id));

export const STORY_PENDING: PendingList<string> = {
  ns: "warehouseTransfer.detail",
  parts: [
    { id: "costEvent", kind: "missing" },
    { id: "labelPhoto", kind: "dropped" },
  ],
};
