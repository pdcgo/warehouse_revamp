import type { ScanOutcome } from "../../status";

// ── THE SOUND IS THE INTERFACE ──────────────────────────────────────────────────────────────────
//
// The floor app ships eight audio files, and finding them is what makes the rest of it make sense.
// An operator at a shelf is holding a parcel and a scanner. They are not looking at the screen —
// they cannot be, the screen is on a trolley two metres away — so the ONLY channel back to them is
// sound, and every scan outcome has its own.
//
// A visual-only design fails here in a way that is invisible in review: the operator scans, hears
// nothing, assumes it worked, and moves on. The error is discovered at dispatch.
//
//   accepted      a short rising chime      keep going
//   duplicate     a distinct "already had that" tone — NOT the error sound, because scanning the
//                 same parcel twice is a normal thing to do when you lose your place in a stack
//   not_found     a flat buzz               this parcel is not in this batch
//   wrong_status  a different buzz          it is in the batch but not ready — the packer has not
//                                           finished, and carrying it to the courier loses it
//
// ⚠ THE FOUR SOUNDS MUST BE DISTINGUISHABLE WITH YOUR BACK TURNED. That is the whole requirement,
// and it is why there are four and not nine — the original also has order-cancel, order-return,
// on-the-way and a spoken "packing not finished" clip, which is past the number a person reliably
// tells apart in a noisy room.
//
// ── AND IT IS NEVER SOUND ALONE ─────────────────────────────────────────────────────────────────
//
// Audio is a second channel, not the only one. It fails silently in every one of these cases:
// a muted tablet, a shared room where sound is turned off, a hard-of-hearing operator, and the
// browser autoplay policy below. So every outcome also lands as a visible row with its own tone and
// icon — the sound tells you to look, the screen tells you what happened.

export const SCAN_SOUND: Record<ScanOutcome, string> = {
  accepted: "correct.mp3",
  duplicate: "fulfilled.wav",
  not_found: "wrong.wav",
  wrong_status: "check-error.mp3",
};

export interface ScanFeedback {
  play(outcome: ScanOutcome): void;
  // What the page last tried to play. The stories assert on this — a real <audio> element cannot be
  // heard by a test, and mocking the browser's audio stack proves nothing about the design.
  lastPlayed(): ScanOutcome | undefined;
}

// ⚠ AUTOPLAY IS BLOCKED UNTIL THE PAGE HAS BEEN INTERACTED WITH.
//
// Every browser refuses programmatic audio until the user has clicked, tapped or pressed a key on
// the page. On the floor that is a genuine failure mode: the tablet is put on its stand, the station
// opens, the first scan is silent — and a silent scan reads as an accepted scan.
//
// A scanner keypress DOES satisfy the gesture requirement, so it self-heals after the first scan.
// That is not good enough: the first scan is the one that gets trusted. A station using this must
// arm the audio behind a visible control the operator presses before starting, and must show
// whether sound is currently armed. `armed` below is what that control sets.
export function createScanFeedback(options?: { armed?: boolean }): ScanFeedback {
  let last: ScanOutcome | undefined;
  const armed = options?.armed ?? false;

  return {
    play(outcome) {
      last = outcome;
      if (!armed) return;
      // Reference port: the real implementation constructs an Audio() per outcome and rewinds it
      // before each play, so two scans in quick succession both sound rather than the second being
      // swallowed by the first still playing.
    },
    lastPlayed: () => last,
  };
}
