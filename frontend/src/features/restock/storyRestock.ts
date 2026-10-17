import { create } from "@bufbuild/protobuf";

import { restockWire } from "../../../.storybook/restockStub";
import { RestockRequestSchema } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// STORY-ONLY helper for the restock feature components — a fixture restock as a real message. Imported by
// `*.stories.tsx` only.
export const storyRestock = (id: bigint) => create(RestockRequestSchema, restockWire(id));
