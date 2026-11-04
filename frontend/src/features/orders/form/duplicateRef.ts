import { orderClient, orderDraftClient, rpcError } from "../../../api/clients";
import type { OrderDraftByExternalRefsResponse } from "../../../gen/warehouse/selling/v1/order_draft_pb";
import type { OrderByExternalRefsResponse } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";

// THE DUPLICATE MARKETPLACE-REF WARNING'S READ (a-duplicate-ref-is-warned-not-refused,
// the-duplicate-warning-reads-drafts-too).
//
// Before Create — a new order, or a draft being finalized, which is the same form opened with `?draft=` — the form
// asks whether this shop and this ref are already recorded. A find is a WARNING naming what was found, never a
// refusal: the server creates the order whatever its ref (no unique index, no handler check), because a cancelled
// order re-created on its ref, and rarer reasons the owner keeps out of the repo, need the double.
//
// ⚠ TWO READS, side by side: live orders through OrderService.OrderByExternalRefs (each found order carries its own
// `created_at_unix`, so nothing else is read to date it), and drafts through OrderDraftService.OrderDraftByExternalRefs
// — the TEAM's drafts in this shop on this ref, any author's (the-duplicate-ref-warning-is-accepted, settled in chat).

/** One of the team's live orders already on this shop + ref. */
export interface DuplicateOrder {
  id: bigint;
  status: OrderStatus;
  /** When it was typed in — straight off OrderRefItem. */
  createdAtUnix: bigint;
}

/** A draft already holding this shop + ref — never the one being finalized. */
export interface DuplicateDraft {
  id: bigint;
  createdAtUnix: bigint;
}

/** What the check found. `error` set = the check itself failed, and the dialog says so rather than staying quiet. */
export interface DuplicateFinding {
  ref: string;
  orders: DuplicateOrder[];
  drafts: DuplicateDraft[];
  error?: string;
}

/** Whether the finding is worth a dialog: something found, or a check that could not run. */
export function warns(finding: DuplicateFinding): boolean {
  return finding.error !== undefined || finding.orders.length > 0 || finding.drafts.length > 0;
}

/**
 * The LIVE orders of `shopId` in an OrderByExternalRefs answer for `ref`. The RPC answers every status and every shop
 * of the team (it is the settlement importer's read too), so the two rules of the warning are applied here: a
 * CANCELLED order is not warned about — cancel and re-create is the normal path — and another shop's order on the
 * same ref is not this order's double.
 */
export function liveOrdersOn(res: OrderByExternalRefsResponse, ref: string, shopId: bigint) {
  const found = [];

  for (const item of res.items[ref]?.items ?? []) {
    if (item.d.case !== "orderRef") continue;

    for (const order of Object.values(item.d.value.mapData)) {
      if (order.shopId !== shopId || order.status === OrderStatus.CANCEL) continue;
      found.push(order);
    }
  }

  // Oldest first — the order a person most likely meant is the one recorded first.
  return found.sort((a, b) => (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0));
}

/**
 * The drafts in an OrderDraftByExternalRefs answer for `ref` — the server already narrowed them to this shop and
 * left out `manual` drafts (a form-saved draft's external id is no marketplace ref). Oldest first, like the orders.
 */
export function draftsOn(res: OrderDraftByExternalRefsResponse, ref: string): DuplicateDraft[] {
  const found: DuplicateDraft[] = [];

  for (const item of res.items[ref]?.items ?? []) {
    if (item.d.case !== "draftRef") continue;

    for (const draft of Object.values(item.d.value.mapData)) {
      found.push({ id: draft.draftId, createdAtUnix: draft.createdAtUnix });
    }
  }

  return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The drafts worth naming: on this shop and ref, and NEVER the draft being finalized
 * (the-duplicate-warning-reads-drafts-too) — a warning about the very draft a person opened would teach them to click
 * past every warning.
 */
export function otherDrafts<T extends { id: bigint }>(drafts: T[], finalizingDraftId: bigint): T[] {
  return drafts.filter((d) => d.id !== finalizingDraftId);
}

/**
 * The check itself: OrderByExternalRefs and OrderDraftByExternalRefs for the ref, at once — the live orders of this
 * shop kept, and every draft on it but the one being finalized.
 *
 * Never throws: a failed lookup comes back as `error`, so Create is not blocked by a read that is only a warning.
 */
export async function findDuplicateRef({
  teamId,
  shopId,
  ref,
  finalizingDraftId,
}: {
  teamId: bigint;
  shopId: bigint;
  ref: string;
  /** The draft this Create finalizes — 0n for a new order. Never named. */
  finalizingDraftId: bigint;
}): Promise<DuplicateFinding> {
  const trimmed = ref.trim();
  const empty: DuplicateFinding = { ref: trimmed, orders: [], drafts: [] };
  if (trimmed === "" || shopId <= 0n) return empty;

  try {
    const [orderRes, draftRes] = await Promise.all([
      orderClient.orderByExternalRefs({ teamId, filter: { refs: [trimmed] } }),
      orderDraftClient.orderDraftByExternalRefs({ teamId, filter: { shopId, refs: [trimmed] } }),
    ]);

    const orders = liveOrdersOn(orderRes, trimmed, shopId).map(
      (o): DuplicateOrder => ({ id: o.orderId, status: o.status, createdAtUnix: o.createdAtUnix }),
    );
    const drafts = otherDrafts(draftsOn(draftRes, trimmed), finalizingDraftId);

    return { ...empty, orders, drafts };
  } catch (err) {
    return { ...empty, error: rpcError(err) };
  }
}
