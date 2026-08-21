import type { Tone } from "../legacy/components/tone";

// ── THE MOVEMENT VOCABULARY ─────────────────────────────────────────────────────────────────────
//
// ⚠ THE SINGLE MOST IMPORTANT THING FOUND IN THIS PORT, AND IT IS A WARNING.
//
// The floor app has ONE status enum. Inbound, outbound and returns all store the same seven keys —
// and each of the three reads them as a DIFFERENT WORD:
//
//                 inbound                 return                  outbound
//   ongoing       "sent to warehouse"     "return in progress"    "being processed"
//   completed     "received by warehouse" "return accepted"       "handed to the courier"
//   cancel        "cancelled"             —                       "cancelled"
//
// So `completed` means the goods ARRIVED on one screen and LEFT on another. Nothing in the record
// says which; the only disambiguator is which screen you happen to be looking at. Two of the three
// label sets also leave four of the seven keys as empty strings, because those states cannot occur
// in that direction — an enum carrying values that are illegal for most of its users.
//
// That is an accumulated design, and CLAUDE.md's HARD RULE 1 exists precisely so this system does
// not re-derive it. It is reproduced here because a reference that quietly fixed the problem would
// hide the thing most worth seeing.
//
//   → If this vocabulary is ever adopted, the direction belongs IN the state, not in the screen:
//     `received` and `dispatched` are two states, not one state read two ways.

export type MovementStatus =
  | "waiting"
  | "ongoing"
  | "picking"
  | "picked"
  | "packing"
  | "packing_completed"
  | "completed"
  | "cancel";

export type MovementDirection = "inbound" | "return" | "outbound";

interface StatusLabel {
  label: string;
  tone: Tone;
}

// The outbound lifecycle is the long one, and it is the one the floor actually walks:
//
//   waiting → picking → picked → packing → packing_completed → completed
//                                                    ↑
//                            the scan station accepts ONLY this state (see ScanStation)
//
// `cancel` can interrupt from anywhere.
const OUTBOUND: Partial<Record<MovementStatus, StatusLabel>> = {
  waiting: { label: "Awaiting processing", tone: "warning" },
  ongoing: { label: "Being processed", tone: "warning" },
  picking: { label: "Being picked", tone: "warning" },
  picked: { label: "Ready to pack", tone: "success" },
  packing: { label: "Being packed", tone: "info" },
  packing_completed: { label: "Packed", tone: "primary" },
  completed: { label: "Handed to courier", tone: "success" },
  cancel: { label: "Cancelled", tone: "error" },
};

// Inbound has TWO states and a cancel. Everything between them belongs to picking and packing, which
// only happen on the way out.
const INBOUND: Partial<Record<MovementStatus, StatusLabel>> = {
  ongoing: { label: "Sent to warehouse", tone: "info" },
  completed: { label: "Received by warehouse", tone: "success" },
  cancel: { label: "Cancelled", tone: "error" },
};

// A return is an inbound whose reason is a failure, and the original gives it its own colours —
// pink and violet against inbound's blue and green. That is worth keeping: a shelf filling up with
// returns should not look like a shelf filling up with new stock.
const RETURN: Partial<Record<MovementStatus, StatusLabel>> = {
  ongoing: { label: "Return in progress", tone: "warning" },
  completed: { label: "Return accepted", tone: "primary" },
  cancel: { label: "Cancelled", tone: "error" },
};

const BY_DIRECTION: Record<MovementDirection, Partial<Record<MovementStatus, StatusLabel>>> = {
  inbound: INBOUND,
  return: RETURN,
  outbound: OUTBOUND,
};

export function statusLabel(direction: MovementDirection, status: MovementStatus): StatusLabel {
  // The fallback is deliberate and visible. A status that is legal in the enum but has no meaning in
  // this direction is exactly the bug described above, and it should read as one rather than render
  // an empty badge.
  return BY_DIRECTION[direction][status] ?? { label: `${status} (not valid here)`, tone: "plain" };
}

export function statusOptions(direction: MovementDirection): Array<{ value: MovementStatus; label: string }> {
  return Object.entries(BY_DIRECTION[direction]).map(([value, v]) => ({
    value: value as MovementStatus,
    label: v.label,
  }));
}

// ── WHAT A SCAN CAN COME BACK AS ────────────────────────────────────────────────────────────────
//
// Four outcomes, and each has its own SOUND (see scanFeedback). The list is short on purpose: an
// operator with their hands full distinguishes four tones, not nine.
export type ScanOutcome = "accepted" | "duplicate" | "not_found" | "wrong_status";

export const SCAN_OUTCOME_LABEL: Record<ScanOutcome, string> = {
  accepted: "Accepted",
  duplicate: "Already scanned",
  not_found: "Not found",
  wrong_status: "Wrong status",
};

export const SCAN_OUTCOME_TONE: Record<ScanOutcome, Tone> = {
  accepted: "success",
  duplicate: "info",
  not_found: "error",
  wrong_status: "warning",
};
