// selling_service's OrderByExternalRefs and OrderDraftByExternalRefs as Storybook's stub — the two reads behind the
// order form's duplicate marketplace-ref warning (a-duplicate-ref-is-warned-not-refused,
// the-duplicate-warning-reads-drafts-too). The settlement importer is OrderByExternalRefs' other caller.
//
// It answers as the handler does (order_by_external_refs.go): the CALLER's team's orders whose ref is one of those
// asked, in EVERY status and EVERY shop — the warning's own rules (live only, this shop only) are the form's, so a
// story can prove the form applies them. Keyed by ref, then by order id; a ref nobody carries is absent.
//
// The orders are the fixtures' (101 = SP-2409-8841 on Melati Official, pending, yesterday), plus whatever a story adds
// with `withRefOrders` — a cancelled order on a ref, a second order on a draft's ref — and `failing` refuses the read,
// so a story can show the warning that says the check could not run. preview.tsx's `beforeEach` resets it. Each order
// carries its `createdAtUnix` (the fixture order's, when the id is one), as the handler now answers.
//
// The DRAFT read answers as order_draft_by_external_refs.go: the caller's TEAM's drafts (any author's) in the asked
// shop on an asked ref, never a `manual` one — the fixtures' (201 = MEL-9001 in Melati Official, 202 = MEL-9002 in
// Melati Store, both team 12) plus `withRefDrafts`. The draft being finalized is answered too: the form drops it.
//
// ⚠ ITS OWN MODULE, so a story can import the scenario without pulling stubTransport.ts into `npm run typecheck`.

import { Code, ConnectError } from "@connectrpc/connect";

import type {
  OrderDraftByExternalRefsRequest,
  OrderDraftRefItem,
} from "../src/gen/warehouse/selling/v1/order_draft_pb";
import type { OrderByExternalRefsRequest, OrderRefItem } from "../src/gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../src/gen/warehouse/selling/v1/order_pb";
import { orderDrafts, orders } from "./fixtures";

/** One order a story puts on a ref — `orderId` should be a fixture order, so its detail (the date) still reads. */
export interface RefOrder {
  orderId: bigint;
  teamId: bigint;
  shopId: bigint;
  ref: string;
  status: OrderStatus;
  /** When it was typed in — defaults to the fixture order's, else 0. */
  createdAtUnix?: bigint;
}

/** One draft a story puts on a shop + ref, beside the fixtures'. */
export interface RefDraft {
  draftId: bigint;
  teamId: bigint;
  shopId: bigint;
  ref: string;
  createdAtUnix: bigint;
  source?: string;
  authorUserId?: bigint;
}

export const duplicateRefScenario = {
  extra: [] as RefOrder[],
  extraDrafts: [] as RefDraft[],
  /** Refuse every lookup — the network, or the server, failing the read. */
  failing: false,
  /** Every lookup's refs, in order — so a story can say the check ran (or did not). */
  calls: [] as string[][],
  /** Every DRAFT lookup's shop and refs, in order. */
  draftCalls: [] as { shopId: bigint; refs: string[] }[],
};

export function resetDuplicateRefStub() {
  duplicateRefScenario.extra = [];
  duplicateRefScenario.extraDrafts = [];
  duplicateRefScenario.failing = false;
  duplicateRefScenario.calls = [];
  duplicateRefScenario.draftCalls = [];
}

/** A `beforeEach`: these drafts carry these refs, beside the fixtures'. */
export function withRefDrafts(...extra: RefDraft[]) {
  return () => {
    duplicateRefScenario.extraDrafts = [...duplicateRefScenario.extraDrafts, ...extra];
  };
}

/** A `beforeEach`: these orders carry these refs, beside the fixtures'. */
export function withRefOrders(...extra: RefOrder[]) {
  return () => {
    duplicateRefScenario.extra = [...duplicateRefScenario.extra, ...extra];
  };
}

/** A `beforeEach`: the lookup fails. */
export function withFailingRefLookup() {
  return () => {
    duplicateRefScenario.failing = true;
  };
}

export function orderByExternalRefs(req: OrderByExternalRefsRequest) {
  const refs = req.filter?.refs ?? [];
  duplicateRefScenario.calls = [...duplicateRefScenario.calls, [...refs]];

  if (duplicateRefScenario.failing) {
    throw new ConnectError("the order service did not answer", Code.Unavailable);
  }

  const carried: RefOrder[] = [
    ...orders
      .filter((o) => (o.orderExternalRefId ?? "") !== "")
      .map((o) => ({
        orderId: o.id,
        teamId: o.teamId,
        shopId: o.shopId,
        ref: o.orderExternalRefId ?? "",
        status: o.status,
        createdAtUnix: o.createdAtUnix,
      })),
    ...duplicateRefScenario.extra,
  ];

  const items: Record<string, { items: { d: { case: "orderRef"; value: { mapData: Record<string, Partial<OrderRefItem>> } } }[] }> = {};

  for (const o of carried) {
    if (o.teamId !== req.teamId || !refs.includes(o.ref)) continue;

    const list = (items[o.ref] ??= { items: [{ d: { case: "orderRef", value: { mapData: {} } } }] });
    list.items[0]!.d.value.mapData[o.orderId.toString()] = {
      orderId: o.orderId,
      shopId: o.shopId,
      createdByUserId: 0n,
      status: o.status,
      createdAtUnix: o.createdAtUnix ?? orders.find((f) => f.id === o.orderId)?.createdAtUnix ?? 0n,
    };
  }

  return { items };
}

export function orderDraftByExternalRefs(req: OrderDraftByExternalRefsRequest) {
  const refs = req.filter?.refs ?? [];
  const shopId = req.filter?.shopId ?? 0n;
  duplicateRefScenario.draftCalls = [...duplicateRefScenario.draftCalls, { shopId, refs: [...refs] }];

  if (duplicateRefScenario.failing) {
    throw new ConnectError("the order service did not answer", Code.Unavailable);
  }

  const carried: RefDraft[] = [
    ...orderDrafts.map((d) => ({
      draftId: d.id,
      teamId: d.teamId,
      shopId: d.shopId,
      ref: d.externalId,
      createdAtUnix: d.createdAtUnix,
      source: d.source,
      authorUserId: d.authorUserId,
    })),
    ...duplicateRefScenario.extraDrafts,
  ];

  const items: Record<string, { items: { d: { case: "draftRef"; value: { mapData: Record<string, Partial<OrderDraftRefItem>> } } }[] }> = {};

  for (const d of carried) {
    if (d.teamId !== req.teamId || d.shopId !== shopId || d.source === "manual" || !refs.includes(d.ref)) continue;

    const list = (items[d.ref] ??= { items: [{ d: { case: "draftRef", value: { mapData: {} } } }] });
    list.items[0]!.d.value.mapData[d.draftId.toString()] = {
      draftId: d.draftId,
      shopId: d.shopId,
      authorUserId: d.authorUserId ?? 0n,
      createdAtUnix: d.createdAtUnix,
    };
  }

  return { items };
}
