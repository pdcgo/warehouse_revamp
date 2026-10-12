// WHAT A SCREEN CANNOT DO YET — the shape, shared; the LIST, per screen.
//
// The order form was the first screen built ahead of the system, and it carried this machinery in
// its own directory. The orders list is the second, so by the rule in CLAUDE.md it belongs to a
// DOMAIN rather than to one page — what moved here is the type, the numbering and the two components
// that read them. What did NOT move is the list: each screen declares its own, because "what is
// missing" is a fact about that screen and nothing else.
//
// ⚠ THE NUMBER IS THE POSITION IN THE LIST. A badge reading "⚠ 7" and the seventh row of the summary
// are the same derivation, so they cannot drift — and a screen that reorders its list renumbers both
// halves at once.

/**
 * HOW a part is unfinished — four ways, and they cost the reader different things:
 *
 *   dropped → the control works and the value is THROWN AWAY. Somebody types a deadline, presses the
 *             button, and it is gone. That is the lie the summary exists to prevent.
 *   sample  → a read-only panel standing on invented numbers, because the read that would fill it
 *             does not exist. Nothing is lost; what is on screen is simply not true.
 *   derived → computed here and now from real figures, but by a RULE that is not settled yet.
 *   missing → NOT ON THE SCREEN AT ALL, and a total is short because of it. There is no control to
 *             mark, which is exactly why it needs an entry.
 */
export type PendingKind = "dropped" | "sample" | "derived" | "missing";

export interface PendingPart<Id extends string = string> {
  id: Id;
  kind: PendingKind;
}

/** Every screen's list is read through this, so the two components need nothing else. */
export interface PendingList<Id extends string = string> {
  /** The i18n namespace holding `pending.<id>.label` / `.reason` and the screen's own strings. */
  ns: string;
  parts: PendingPart<Id>[];
}

/** The ones whose typed value is thrown away — what the summary warns about by name. */
export function droppedParts<Id extends string>(list: PendingList<Id>): PendingPart<Id>[] {
  return list.parts.filter((p) => p.kind === "dropped");
}

export function pendingPart<Id extends string>(list: PendingList<Id>, id: Id): PendingPart<Id> {
  // Non-null by construction: `Id` is the union of the ids in the list itself, so an id cannot be
  // referenced without being declared first.
  return list.parts.find((p) => p.id === id)!;
}

/** The number on the badge, and the number in the summary — one derivation. */
export function pendingNumber<Id extends string>(list: PendingList<Id>, id: Id): number {
  return list.parts.findIndex((p) => p.id === id) + 1;
}
