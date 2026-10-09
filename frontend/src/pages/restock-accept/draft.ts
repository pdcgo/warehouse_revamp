import type { MessageInitShape } from "@bufbuild/protobuf";

import type {
  RestockRequestItem,
  RestockRequestReceivedLineSchema,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import {
  goodUnits,
  isBrokenOverReceived,
  isCounted,
  isOverCount,
  toBroken,
  toCount,
} from "../../features/restock/counting";

// WHAT THE PERSON AT THE DOOR HAS TYPED for one line, and everything the screen works out from it — in one pure place,
// so the line card, the header's progress, the Accept button and the payload cannot disagree about what "ready" means.
//
// The rules mirror the accept handler (restock_request_accept.go) one for one, because a screen that lets somebody
// press Accept on a count the server refuses is the worst moment to be told:
//
//   received   typed, required — what is IN THE BOX, broken included (any-warehouse-member-counts-what-arrived)
//   broken     typed, optional — blank is none; never above received
//   good       = received − broken → stock, on placements that hold EXACTLY that many (there-is-no-unplaced-pile)
//   missing    = ordered − received, worked out, never typed (a-short-unit-at-the-door-is-missing)
//   over       received above ordered is refused — the selling team edits first (accept-refuses-more-than-the-line-says)
//   placements each named once per line; the handler refuses a placement twice

/** One placement row: where some of the good units go. `place` is a placement id string, "" = not chosen yet. */
export interface PlacementDraft {
  key: string;
  place: string;
  quantity: string;
}

export interface LineDraft {
  /** "" = not counted yet, which is NOT 0 — a blank blocks Accept. */
  received: string;
  /** "" = none broke. */
  broken: string;
  /** The warehouse's optional notes on the broken / missing rows (three-notes-one-writer-each). */
  brokenNote: string;
  missingNote: string;
  placements: PlacementDraft[];
  /**
   * The FIRST row holds whatever the other rows do not — the good units, until the line is split — until somebody
   * types into it. Counting 12 and then typing 12 again into the shelf row is a second count of the same box.
   */
  firstFollows: boolean;
}

let seq = 0;

export function nextKey(): string {
  seq += 1;
  return `p${seq}`;
}

export function emptyLine(): LineDraft {
  return {
    received: "",
    broken: "",
    brokenNote: "",
    missingNote: "",
    placements: [{ key: "first", place: "", quantity: "" }],
    firstFollows: true,
  };
}

export interface PlacementRow extends PlacementDraft {
  /** The units this row puts away — the remainder for a following first row, else what was typed (blank = 0). */
  effective: bigint;
  /** Holds units but names no placement. */
  needsPlace: boolean;
  /** Names a placement another row of this line already holds. */
  duplicate: boolean;
}

export interface LineState {
  counted: boolean;
  received: bigint;
  broken: bigint;
  /** received above ordered, by how many; 0 when not. */
  over: bigint;
  brokenOver: boolean;
  good: bigint;
  missing: bigint;
  /** What the broken / missing units were worth — the line's share, never typed (the-problem-price-is-filled-by-the-system). */
  brokenValue: bigint;
  missingValue: bigint;
  rows: PlacementRow[];
  placed: bigint;
  /** good − placed: above 0 still to place, below 0 too many. */
  toPlace: bigint;
  needsPlace: boolean;
  duplicate: boolean;
  ready: boolean;
}

// The line's share of its total for n units: line total × n ÷ line count, rounded down like the server.
export function shareOf(item: RestockRequestItem, n: bigint): bigint {
  if (item.count <= 0n || n <= 0n) return 0n;

  return (item.total * n) / item.count;
}

export function lineState(item: RestockRequestItem, draft: LineDraft): LineState {
  const counted = isCounted(draft.received);
  const received = toCount(draft.received);
  const broken = toBroken(draft.broken);

  const over = counted && isOverCount(received, item.count) ? received - item.count : 0n;
  const brokenOver = counted && isBrokenOverReceived(broken, received);
  const good = counted && !brokenOver ? goodUnits(received, broken) : 0n;
  const missing = counted && over === 0n ? item.count - received : 0n;

  // Blank is 0 for a placement quantity too — toBroken is "blank or a count".
  const others = draft.placements.slice(1).reduce((sum, row) => sum + toBroken(row.quantity), 0n);

  const rows: PlacementRow[] = draft.placements.map((row, i) => {
    const effective =
      i === 0 && draft.firstFollows ? (good - others > 0n ? good - others : 0n) : toBroken(row.quantity);

    return { ...row, effective, needsPlace: effective > 0n && row.place === "", duplicate: false };
  });

  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    if (row.effective === 0n || row.place === "") return;

    const first = seen.get(row.place);
    if (first === undefined) {
      seen.set(row.place, i);
      return;
    }

    row.duplicate = true;
    rows[first]!.duplicate = true;
  });

  // A line with no good units sends no placements at all — whatever rows are on screen are not asked about.
  const relevant = good > 0n;
  const placed = relevant ? rows.reduce((sum, row) => sum + row.effective, 0n) : 0n;
  const toPlace = relevant ? good - placed : 0n;
  const needsPlace = relevant && rows.some((row) => row.needsPlace);
  const duplicate = relevant && rows.some((row) => row.duplicate);

  const ready =
    counted &&
    over === 0n &&
    !brokenOver &&
    (!relevant || (toPlace === 0n && !needsPlace && !duplicate));

  return {
    counted,
    received,
    broken,
    over,
    brokenOver,
    good,
    missing,
    brokenValue: shareOf(item, brokenOver ? 0n : broken),
    missingValue: shareOf(item, missing),
    rows,
    placed,
    toPlace,
    needsPlace,
    duplicate,
    ready,
  };
}

// The line as RestockRequestReceivedLine — only called once every line is ready, so every number here is one the
// handler accepts. A note is sent only beside a row it can belong to.
export function receivedLine(
  item: RestockRequestItem,
  draft: LineDraft,
  st: LineState,
): MessageInitShape<typeof RestockRequestReceivedLineSchema> {
  return {
    itemId: item.id,
    receivedCount: st.received,
    brokenCount: st.broken,
    brokenNote: st.broken > 0n ? draft.brokenNote.trim() : "",
    missingNote: st.missing > 0n ? draft.missingNote.trim() : "",
    placements:
      st.good > 0n
        ? st.rows
            .filter((row) => row.effective > 0n && row.place !== "")
            .map((row) => ({ placementId: BigInt(row.place), quantity: row.effective }))
        : [],
  };
}
