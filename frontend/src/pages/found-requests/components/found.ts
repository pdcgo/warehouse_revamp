import type { TFunction } from "i18next";

import {
  type FoundRequest,
  FoundRequestApproveBlock,
  FoundRequestPostType,
  FoundRequestStatus,
} from "../../../gen/warehouse/inventory/v1/found_request_pb";

// WHAT THE FOUND STOCK SCREEN'S PARTS SHARE — the row, the phone's block and the Rincian read a request the same way.

// A found request's status — a lifecycle step, so its colour is categorical (as the stock count's session status).
export const STATUS: Record<FoundRequestStatus, { key: string; color: string }> = {
  [FoundRequestStatus.UNSPECIFIED]: { key: "foundRequest.status.unspecified", color: "gray" },
  [FoundRequestStatus.WAITING]: { key: "foundRequest.status.waiting", color: "orange" },
  [FoundRequestStatus.APPROVED]: { key: "foundRequest.status.approved", color: "green" },
  [FoundRequestStatus.REJECTED]: { key: "foundRequest.status.rejected", color: "gray" },
  [FoundRequestStatus.SETTLED_BY_COUNT]: { key: "foundRequest.status.settled", color: "blue" },
};

// What a posting line does — the stock count's finalize draws the same two the same way (opname-finalize): money coming
// back, and stock with no money.
export const POST: Record<FoundRequestPostType, { key: string; color: string }> = {
  [FoundRequestPostType.UNSPECIFIED]: { key: "foundRequest.post.unspecified", color: "gray" },
  [FoundRequestPostType.CLAIM]: { key: "foundRequest.post.claim", color: "success" },
  [FoundRequestPostType.MINT]: { key: "foundRequest.post.mint", color: "info" },
};

/** A rejection by the person who reported it is their withdrawal (the-reporter-may-withdraw-their-found). */
export function isWithdrawn(r: FoundRequest): boolean {
  return r.status === FoundRequestStatus.REJECTED && r.decidedById !== 0n && r.decidedById === r.reportedById;
}

/** Why THIS person cannot approve it now — the server's `block`, in words; empty when they can. */
export function blockTextOf(r: FoundRequest, t: TFunction): string {
  switch (r.block) {
    case FoundRequestApproveBlock.OWN_REPORT:
      return t("foundRequest.block.ownReport");
    case FoundRequestApproveBlock.BEING_COUNTED:
      return t("foundRequest.block.beingCounted", { id: r.countingSessionId.toString(), rack: r.rackCode });
    default:
      return "";
  }
}

/** The decided line — who approved, rejected, withdrew or closed it by a count's finalize, and when. */
export function decidedTextOf(r: FoundRequest, t: TFunction, name: string, when: string): string {
  const key =
    r.status === FoundRequestStatus.APPROVED
      ? "foundRequest.card.approved"
      : r.status === FoundRequestStatus.SETTLED_BY_COUNT
        ? "foundRequest.card.settledBy"
        : isWithdrawn(r)
          ? "foundRequest.card.withdrawn"
          : "foundRequest.card.rejected";

  return t(key, { name, when });
}
