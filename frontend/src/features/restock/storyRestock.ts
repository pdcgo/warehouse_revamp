import { create } from "@bufbuild/protobuf";

import { restockWire } from "../../../.storybook/restockStub";
import { RestockRequestSchema } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import type { PendingList } from "../pending/registry";

// STORY-ONLY helpers for the restock feature components — a fixture restock as a real message, and a pending list
// carrying every id the action components look up. Imported by `*.stories.tsx` only.
export const storyRestock = (id: bigint) => create(RestockRequestSchema, restockWire(id));

export const STORY_PENDING: PendingList<string> = {
  ns: "restock.detail",
  parts: [
    { id: "moneyReturned", kind: "dropped" },
    { id: "markLost", kind: "dropped" },
    { id: "signForBox", kind: "dropped" },
  ],
};
