// THE UNBOXING SWITCH, REMEMBERED ON THIS DEVICE (the-unboxing-warning-is-one-sentence-on-each-label), as Cetak Label's
// settings are (the-label-settings-are-remembered): browser storage, per device — the printer sits beside one machine —
// written on every change, by itself.
//
// Only a switch turned ON is stored: off is the default, so an untouched page stores nothing. Storage that is missing or
// refuses leaves the switch off.
//
// The sentence itself is the server's (OrderLabels' one constant) — the page sends a yes or no, never the words.

export const UNBOXING_STORAGE_KEY = "print-receipts.unboxing.v1";

export function loadUnboxing(): boolean {
  try {
    return window.localStorage.getItem(UNBOXING_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveUnboxing(on: boolean) {
  try {
    if (on) {
      window.localStorage.setItem(UNBOXING_STORAGE_KEY, "on");
    } else {
      window.localStorage.removeItem(UNBOXING_STORAGE_KEY);
    }
  } catch {
    // Storage refused (a private window, blocked site data) — the switch still holds for this visit.
  }
}
