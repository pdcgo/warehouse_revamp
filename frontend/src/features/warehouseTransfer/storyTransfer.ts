import { create } from "@bufbuild/protobuf";

import { transferWire } from "../../../.storybook/warehouseTransferStub";
import { WarehouseTransferSchema } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";

// STORY-ONLY helper for the warehouse transfer feature components — a fixture transfer as a real message. Imported by
// `*.stories.tsx` only.
export const storyTransfer = (id: bigint) => create(WarehouseTransferSchema, transferWire(id));
