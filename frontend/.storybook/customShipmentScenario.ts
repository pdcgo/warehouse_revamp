// WHAT THE CUSTOM SHIPMENTS' STUB HEARD AND SAID (backlog #88) — imported by the stub (customShipmentStub.ts) and by the
// stories, never the stub itself by a story (the CLAUDE.md rule: a story importing a stub pulls it into typecheck).
// Reset by the stub's own reset, which preview.tsx runs before every story.
//
//   calls     every request the screens sent, in order — the real proto request, as the server would read it
//   answered  every parcel the stub SENT, by the reader's team — what the screen was given, so a story can pin that a
//             warehouse is answered no seller money (a-warehouse-sees-no-seller-money), not merely that it draws none

export interface CustomShipmentCall {
  rpc: string;
  // The request as the stub received it — a proto message; stories match the fields they care about.
  req: Record<string, unknown>;
}

export interface CustomShipmentAnswered {
  rpc: string;
  teamId: bigint;
  shipment: {
    id: bigint;
    total?: number;
    shippingCost?: number;
    financeAccountId: bigint;
    items: { total?: number }[];
    logs: { description: string; fromStatus: number; toStatus: number }[];
  };
}

export const customShipmentScenario = {
  calls: [] as CustomShipmentCall[],
  answered: [] as CustomShipmentAnswered[],
  /** Set by a story: the next write of this RPC is refused with the server's sentence (FailedPrecondition). */
  refuseNext: null as null | { rpc: string; message: string },
};

export function resetCustomShipmentScenario() {
  customShipmentScenario.calls.length = 0;
  customShipmentScenario.answered.length = 0;
  customShipmentScenario.refuseNext = null;
}

/** The writes only — what the screens ASKED the server to do (the reads every mount makes are left out). */
export const customShipmentWrites = () =>
  customShipmentScenario.calls.filter((c) => !["CustomShipmentList", "CustomShipmentDetail", "CustomShipmentReshipOptions"].includes(c.rpc));

/** The list requests' free text, in order — what the search box sent. */
export const customShipmentListTerms = () =>
  customShipmentScenario.calls.filter((c) => c.rpc === "CustomShipmentList").map((c) => (c.req.filter as { q?: string } | undefined)?.q ?? "");
