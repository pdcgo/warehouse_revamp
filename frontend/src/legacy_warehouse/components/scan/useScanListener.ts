import { useEffect, useRef } from "react";

// ── THE KEYBOARD-WEDGE SCANNER ──────────────────────────────────────────────────────────────────
//
// This is the interaction the whole floor app is built around, and it is worth understanding before
// designing anything for a warehouse.
//
// A handheld barcode scanner is a KEYBOARD. It types the code it read, then presses Enter. It has no
// API, it does not know what a text field is, and it cannot be focused. So the app listens on the
// DOCUMENT — not on an input — and every screen that accepts scans is usable with no cursor placed
// anywhere.
//
// ⚠ THAT IS THE POINT, AND IT IS EASY TO GET WRONG. The obvious design is "a search box you scan
// into", and it fails on the floor: the operator is holding a parcel in one hand and a scanner in
// the other, and any click required to restore focus is a click they cannot make. A tap on the page
// to dismiss a dialog would silently disarm the station.
//
// ── TELLING A SCAN FROM TYPING ──────────────────────────────────────────────────────────────────
//
// The buffer is cleared after `IDLE_MS` of no keypress. A scanner emits its whole code in a few
// milliseconds; a human types at ~150–300ms per character. So the gap is the discriminator: nothing
// a person types by hand ever survives to reach Enter, and the operator can talk, type a note in
// another window, or lean on the desk without corrupting a scan.
//
//   scan:   4 1 2 8 9 3 ⏎        all within ~20ms      → accepted
//   typing: 4 … 1 … 2 …          >100ms between keys   → buffer cleared each time, never fires
//
// 100ms is the original's value and it is a real trade-off, not a magic number: raise it and slow
// human typing starts registering, lower it and a scanner on a loaded page can drop a code.
const IDLE_MS = 100;

// Which characters can be part of a code. Deliberately narrow — a scanner emits alphanumerics plus
// the two separators used by the labels here, and anything else is a person pressing a key.
const CODE_CHAR = /^[a-zA-Z0-9\-|]$/;

export interface ScanListenerOptions {
  onScan(code: string): void;
  // Stop listening without unmounting — a dialog that owns the scanner, a screen that is not the
  // active tab. An unlistened station is invisible, so anything using this should say so on screen.
  enabled?: boolean;
  // Report what is in the buffer right now. The original had no such thing, and an operator whose
  // scanner is mis-reading gets no feedback at all — see ScanBuffer.
  onBuffer?(buffer: string): void;
}

export function useScanListener({ onScan, enabled = true, onBuffer }: ScanListenerOptions) {
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The handler is registered once and reads the latest callbacks through a ref, so a parent that
  // re-renders on every scan (all of them do — the tally grows) does not detach and reattach the
  // document listener mid-burst and lose the characters in flight.
  const handlers = useRef({ onScan, onBuffer });
  handlers.current = { onScan, onBuffer };

  useEffect(() => {
    if (!enabled) return;

    const setBuffer = (next: string) => {
      bufferRef.current = next;
      handlers.current.onBuffer?.(next);
    };

    const onKeyPress = (event: KeyboardEvent) => {
      clearTimeout(timerRef.current);

      if (event.key === "Enter") {
        const code = bufferRef.current;
        setBuffer("");
        // An empty Enter is a person pressing return, not a scan of nothing.
        if (code) handlers.current.onScan(code.toUpperCase());
        return;
      }

      if (CODE_CHAR.test(event.key)) setBuffer(bufferRef.current + event.key);

      timerRef.current = setTimeout(() => setBuffer(""), IDLE_MS);
    };

    document.addEventListener("keypress", onKeyPress);
    return () => {
      document.removeEventListener("keypress", onKeyPress);
      clearTimeout(timerRef.current);
    };
  }, [enabled]);
}

// Exported so a story can drive the station the way a scanner does, and so the timing above is
// stated once rather than re-guessed by every test.
export const SCAN_IDLE_MS = IDLE_MS;
