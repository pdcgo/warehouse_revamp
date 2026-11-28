import { useState } from "react";

import { PLACEMENT_KINDS } from "../../features/inventory/movementKind";
import { useRackHistory } from "../../features/racks/queries";

/** Riwayat's chips: every movement, or only the ones that decided goods live here. */
export type HistoryLens = "all" | "placement";

interface LedgerState {
  /** Whose state this is — the team and the rack it was chosen on. */
  subject: string;
  lens: HistoryLens;
  page: number;
  pageSize: number;
}

const FIRST = { lens: "all", page: 1, pageSize: 20 } as const;

// WHAT HAS HAPPENED TO THIS SHELF, ONE PAGE OF IT — Riwayat's read (features/racks useRackHistory) and its state: the
// lens chip and the pager.
//
// THE PAGE'S, NOT THE SECTION'S (#134, the-speed-audits-old-findings-are-fixed-smallest-first) — as the shelf's is
// (useRackShelf). The ledger needs only the address's rack, but the section that read it mounts only once the rack itself
// is named, so it waited for RackDetail: the speed audit's RackDetail → RackHistory → ProductByIds / UserByIDs. Held
// here, it is asked beside the rack and the shelf, and the section draws what it answers.
//
// The state belongs to ONE rack: another rack (or team) under the same page starts on Semua, page one, twenty a page —
// as the section did when it mounted afresh under the new rack. Derived from the subject rather than reset in an effect,
// so no read for the old rack's page goes out under the new one.
export function useRackLedger(teamId: bigint | undefined, rackId: bigint) {
  const subject = `${teamId ?? ""}:${rackId}`;
  const [held, setHeld] = useState<LedgerState>({ subject, ...FIRST });
  const state: LedgerState = held.subject === subject ? held : { subject, ...FIRST };
  // A change applies to THIS rack's state — the one held, or the first one when the rack has just changed.
  const change = (patch: Partial<Omit<LedgerState, "subject">>) =>
    setHeld((prev) => ({ ...(prev.subject === subject ? prev : { subject, ...FIRST }), ...patch }));

  const kinds = state.lens === "placement" ? PLACEMENT_KINDS : undefined;
  const query = useRackHistory({ teamId, rackId, kinds, page: state.page, pageSize: state.pageSize });

  return {
    query,
    lens: state.lens,
    page: state.page,
    pageSize: state.pageSize,
    /** The chip's value, as the pager's reset key reads it. */
    kindKey: (kinds ?? []).join(","),
    /** Another lens is another question: page one. */
    setLens: (lens: HistoryLens) => change({ lens, page: 1 }),
    setPage: (page: number) => change({ page }),
    /** Another page size starts from page one. */
    setPageSize: (pageSize: number) => change({ pageSize, page: 1 }),
  };
}

/** Riwayat's read and state, as the page hands them to its section. */
export type RackLedger = ReturnType<typeof useRackLedger>;
