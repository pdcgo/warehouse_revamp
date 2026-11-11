import type { OrderItem } from "../../gen/warehouse/selling/v1/order_pb";

/** One line of the accept as OrderReturnAccept carries it: what did NOT come back sound, the note, and the racks. */
export interface ReturnAcceptLine {
  orderItemId: bigint;
  /** Too damaged to sell — thrown away at the door (a-broken-returned-unit-is-thrown-away-at-the-door). */
  broken: number;
  /** Not in the box — missing at the door (a-short-return-is-missing-at-the-door). */
  missing: number;
  /** The crew's optional note on the broken and missing units (a-return-door-row-carries-an-optional-note); "" when neither. */
  note: string;
  /** The sound units' racks, adding up to exactly ordered − broken − missing (there-is-no-unplaced-pile). */
  placements: { rackId: bigint; quantity: number }[];
}

// WHAT THE CREW HAS TYPED for one returned line, and everything the page works out from it — in one pure place, so the
// line card, the summary, the header's progress, the Accept button and the request cannot disagree about "ready".
//
// The parcel is WHOLE (a-return-is-never-partial): every line comes back at its ordered quantity, so the crew types only
// what did NOT come back sound — both blank in the common case:
//
//   missing   typed, blank = none — not in the box (a-short-return-is-missing-at-the-door)
//   broken    typed, blank = none — too damaged to sell, thrown away (a-broken-returned-unit-is-thrown-away-at-the-door)
//   sound     = ordered − broken − missing, worked out, never typed, never below 0: broken + missing above the line
//               is said on the line and holds Accept
//   note      optional, shown once broken or missing is above 0 (a-return-door-row-carries-an-optional-note)
//   racks     the sound units onto racks of THIS warehouse, adding up to exactly `sound` (there-is-no-unplaced-pile),
//             each rack once per line — Accept Delivery's put-away, split across racks the same way

/** One rack row: where some of the sound units go. `rack` is a rack id string, "" = not chosen yet. */
export interface RackDraft {
  key: string;
  rack: string;
  quantity: string;
}

export interface ReturnLineDraft {
  missing: string;
  broken: string;
  /** The crew's note on what is broken or missing — sent only while either is above 0. */
  note: string;
  racks: RackDraft[];
  /**
   * The FIRST row holds whatever the other rows do not — every sound unit, until the line is split — until somebody types
   * into it, as on Accept Delivery: count, pick a rack, done.
   */
  firstFollows: boolean;
}

let seq = 0;

export function nextRackKey(): string {
  seq += 1;
  return `r${seq}`;
}

export function emptyReturnLine(): ReturnLineDraft {
  return { missing: "", broken: "", note: "", racks: [{ key: "first", rack: "", quantity: "" }], firstFollows: true };
}

/** Blank or a whole count — anything else reads 0. */
export function toUnits(raw: string): number {
  const n = Number(raw.trim());

  return Number.isInteger(n) && n > 0 ? n : 0;
}

export interface RackRow extends RackDraft {
  /** The units this row puts away — the remainder for a following first row, else what was typed. */
  effective: number;
  /** Holds units but names no rack. */
  needsRack: boolean;
  /** Names a rack another row of this line already holds. */
  duplicate: boolean;
}

export interface ReturnLineState {
  ordered: number;
  /** The note as it is sent: trimmed, and "" unless something is broken or missing. */
  note: string;
  missing: number;
  broken: number;
  /** broken + missing above the ordered quantity, by how many; 0 when not. */
  over: number;
  /** ordered − broken − missing; 0 while `over`. */
  sound: number;
  rows: RackRow[];
  placed: number;
  /** sound − placed: above 0 still to place, below 0 too many. */
  toPlace: number;
  needsRack: boolean;
  duplicate: boolean;
  ready: boolean;
}

export function returnLineState(item: Pick<OrderItem, "quantity">, draft: ReturnLineDraft): ReturnLineState {
  const ordered = item.quantity;
  const missing = toUnits(draft.missing);
  const broken = toUnits(draft.broken);
  const over = Math.max(0, broken + missing - ordered);
  const sound = over > 0 ? 0 : ordered - broken - missing;

  const others = draft.racks.slice(1).reduce((sum, row) => sum + toUnits(row.quantity), 0);

  const rows: RackRow[] = draft.racks.map((row, i) => {
    const effective = i === 0 && draft.firstFollows ? Math.max(0, sound - others) : toUnits(row.quantity);

    return { ...row, effective, needsRack: effective > 0 && row.rack === "", duplicate: false };
  });

  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    if (row.effective === 0 || row.rack === "") return;

    const first = seen.get(row.rack);
    if (first === undefined) {
      seen.set(row.rack, i);
      return;
    }

    row.duplicate = true;
    rows[first]!.duplicate = true;
  });

  // A line with nothing sound puts nothing away — whatever rows are on screen are not asked about.
  const relevant = sound > 0;
  const placed = relevant ? rows.reduce((sum, row) => sum + row.effective, 0) : 0;
  const toPlace = relevant ? sound - placed : 0;
  const needsRack = relevant && rows.some((row) => row.needsRack);
  const duplicate = relevant && rows.some((row) => row.duplicate);

  const ready = over === 0 && (!relevant || (toPlace === 0 && !needsRack && !duplicate));

  const note = broken + missing > 0 ? draft.note.trim() : "";

  return { ordered, note, missing, broken, over, sound, rows, placed, toPlace, needsRack, duplicate, ready };
}

/** The line as the accept carries it — called only once every line is ready. */
export function acceptLine(orderItemId: bigint, st: ReturnLineState): ReturnAcceptLine {
  return {
    orderItemId,
    broken: st.broken,
    missing: st.missing,
    note: st.note,
    placements:
      st.sound > 0
        ? st.rows
            .filter((row) => row.effective > 0 && row.rack !== "")
            .map((row) => ({ rackId: BigInt(row.rack), quantity: row.effective }))
        : [],
  };
}
